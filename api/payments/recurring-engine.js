import { kv } from "../../../lib/server/kv.js";

const MEMORY = {
  schedules: new Map(),
  scheduleIds: new Set(),
  paymentLogs: [],
  locks: new Map(),
};

const SUPPORTED_FREQUENCIES = new Set([
  "daily",
  "weekly",
  "bi-weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
]);

function isValidDate(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime());
}

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return fallback;
  return d;
}

function addMonthsSafe(date, months) {
  const out = new Date(date);
  const sourceDay = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)
  ).getUTCDate();
  out.setUTCDate(Math.min(sourceDay, lastDay));
  return out;
}

function advanceExecutionDateOnce({
  frequency,
  customIntervalSeconds,
  fromDate,
}) {
  const f = String(frequency || "").toLowerCase();
  if (!SUPPORTED_FREQUENCIES.has(f)) {
    throw new Error(`Unsupported frequency: ${frequency}`);
  }
  const cursor = new Date(fromDate);
  if (!Number.isFinite(cursor.getTime())) {
    throw new Error("Invalid execution date cursor");
  }
  switch (f) {
    case "daily":
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      break;
    case "weekly":
      cursor.setUTCDate(cursor.getUTCDate() + 7);
      break;
    case "bi-weekly":
      cursor.setUTCDate(cursor.getUTCDate() + 14);
      break;
    case "monthly":
      return addMonthsSafe(cursor, 1).toISOString();
    case "quarterly":
      return addMonthsSafe(cursor, 3).toISOString();
    case "yearly":
      return addMonthsSafe(cursor, 12).toISOString();
    case "custom": {
      const secs = Number(customIntervalSeconds || 0);
      if (!Number.isFinite(secs) || secs <= 0) {
        throw new Error("customIntervalSeconds must be > 0 for custom frequency");
      }
      cursor.setUTCSeconds(cursor.getUTCSeconds() + secs);
      break;
    }
    default:
      throw new Error(`Unsupported frequency: ${f}`);
  }
  return cursor.toISOString();
}

export function computeNextExecutionDate({
  frequency,
  customIntervalSeconds,
  lastExecutionAt,
  startAt,
  now = new Date(),
}) {
  const baseline = parseDate(lastExecutionAt, parseDate(startAt, now));
  if (!baseline || !Number.isFinite(baseline.getTime())) {
    throw new Error("Invalid baseline date for recurring execution");
  }
  const nowDate = new Date(now);

  let next = new Date(baseline).toISOString();
  while (new Date(next).getTime() <= nowDate.getTime()) {
    next = advanceExecutionDateOnce({
      frequency,
      customIntervalSeconds,
      fromDate: next,
    });
  }
  return next;
}

async function kvSafe(fn, fallbackValue) {
  try {
    return await fn();
  } catch {
    return fallbackValue;
  }
}

async function putSchedule(schedule) {
  MEMORY.schedules.set(schedule.id, schedule);
  MEMORY.scheduleIds.add(schedule.id);

  await kvSafe(() => kv.set(`recurring:schedule:${schedule.id}`, schedule), null);
  await kvSafe(() => kv.sadd("recurring:schedules", schedule.id), null);
}

async function getSchedule(id) {
  const fromKv = await kvSafe(() => kv.get(`recurring:schedule:${id}`), null);
  if (fromKv) return fromKv;
  return MEMORY.schedules.get(id) || null;
}

async function getAllSchedules() {
  const ids = await kvSafe(() => kv.smembers("recurring:schedules"), null);
  const allIds = Array.isArray(ids) && ids.length > 0 ? ids : Array.from(MEMORY.scheduleIds);
  const items = await Promise.all(allIds.map((id) => getSchedule(id)));
  return items.filter(Boolean);
}

async function appendPaymentLog(entry) {
  MEMORY.paymentLogs.push(entry);
  if (MEMORY.paymentLogs.length > 1000) MEMORY.paymentLogs.shift();
  await kvSafe(() => kv.lpush("recurring:payment_logs", JSON.stringify(entry)), null);
}

async function listPaymentLogs(limit = 100) {
  const rows = await kvSafe(() => kv.lrange("recurring:payment_logs", 0, Math.max(0, limit - 1)), null);
  if (Array.isArray(rows) && rows.length) {
    return rows
      .map((v) => {
        try {
          return typeof v === "string" ? JSON.parse(v) : v;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return MEMORY.paymentLogs.slice(-limit).reverse();
}

async function acquireScheduleLock(id, ttlSeconds = 45) {
  const lockKey = `recurring:lock:${id}`;
  const lockValue = `${Date.now()}-${Math.random()}`;
  const lockUntil = Date.now() + ttlSeconds * 1000;

  // Local process lock fallback.
  const local = MEMORY.locks.get(lockKey);
  if (local && local.until > Date.now()) {
    return null;
  }
  MEMORY.locks.set(lockKey, { value: lockValue, until: lockUntil });

  // Distributed lock best effort.
  const kvLocked = await kvSafe(
    () => kv.set(lockKey, lockValue, { nx: true, ex: ttlSeconds }),
    true
  );
  if (!kvLocked) {
    MEMORY.locks.delete(lockKey);
    return null;
  }

  return {
    key: lockKey,
    value: lockValue,
  };
}

async function releaseScheduleLock(lock) {
  if (!lock) return;
  MEMORY.locks.delete(lock.key);
  await kvSafe(async () => {
    const cur = await kv.get(lock.key);
    if (cur === lock.value) await kv.del(lock.key);
  }, null);
}

function validateScheduleInput(input) {
  const required = [
    "payerAddress",
    "amount",
    "tokenAddress",
    "frequency",
  ];
  for (const key of required) {
    if (input[key] == null || input[key] === "") {
      throw new Error(`Missing required field: ${key}`);
    }
  }

  const frequency = String(input.frequency).toLowerCase();
  if (!SUPPORTED_FREQUENCIES.has(frequency)) {
    throw new Error(`Unsupported frequency "${input.frequency}"`);
  }
  if (frequency === "custom") {
    const secs = Number(input.customIntervalSeconds || 0);
    if (!Number.isFinite(secs) || secs <= 0) {
      throw new Error("customIntervalSeconds must be > 0 when frequency is custom");
    }
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }

  if (input.startAt && !isValidDate(input.startAt)) {
    throw new Error("startAt must be a valid ISO date");
  }

  const recipientWallet = String(input.recipientWallet || "").trim();
  const spendKey = String(input.receiverSpendPublicKey || "").trim();
  const viewKey = String(input.receiverViewPublicKey || "").trim();
  const hasStealthKeys = !!(spendKey && viewKey);
  if (!recipientWallet && !hasStealthKeys) {
    throw new Error(
      "Missing required recipient details: provide recipientWallet (ZK pool route) or receiverSpendPublicKey + receiverViewPublicKey (stealth route)."
    );
  }
}

function buildRetryDate(now, attempts, backoffSeconds) {
  const exp = Math.min(10, Math.max(0, attempts - 1));
  const waitSeconds = Math.floor(backoffSeconds * Math.pow(2, exp));
  const d = new Date(now);
  d.setUTCSeconds(d.getUTCSeconds() + waitSeconds);
  return d.toISOString();
}

export class RecurringPaymentEngine {
  constructor({
    executionHandler,
    maxBatchSize = 50,
    maxCatchupPerRun = Number(process.env.RECURRING_MAX_CATCHUP_PER_RUN || 3),
  } = {}) {
    this.executionHandler = executionHandler || this.defaultExecutionHandler.bind(this);
    this.maxBatchSize = maxBatchSize;
    this.maxCatchupPerRun = Math.max(
      1,
      Math.min(20, Number.isFinite(Number(maxCatchupPerRun)) ? Number(maxCatchupPerRun) : 3)
    );
  }

  async createSchedule(input) {
    validateScheduleInput(input);
    const now = new Date();
    const startAt = input.startAt ? new Date(input.startAt).toISOString() : now.toISOString();
    const id = input.id || `rp_${crypto.randomUUID()}`;
    const frequency = String(input.frequency).toLowerCase();

    const schedule = {
      id,
      payerAddress: input.payerAddress,
      receiverSpendPublicKey: input.receiverSpendPublicKey,
      receiverViewPublicKey: input.receiverViewPublicKey,
      recipientWallet: input.recipientWallet
        ? String(input.recipientWallet).trim()
        : "",
      amount: Number(input.amount),
      tokenAddress: input.tokenAddress,
      frequency,
      customIntervalSeconds:
        frequency === "custom" ? Number(input.customIntervalSeconds) : null,
      status: "active",
      startAt,
      nextExecutionAt: startAt,
      maxRetries: Number(input.maxRetries || 5),
      retryBackoffSeconds: Number(input.retryBackoffSeconds || 60),
      retryCount: 0,
      lastExecutionAt: null,
      lastFailureAt: null,
      failureReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata: input.metadata || null,
    };

    await putSchedule(schedule);
    return schedule;
  }

  async listSchedules() {
    return await getAllSchedules();
  }

  async getScheduleById(id) {
    return await getSchedule(id);
  }

  async listPaymentLogs(limit = 100) {
    return await listPaymentLogs(limit);
  }

  async cancelSchedule(scheduleId) {
    const current = await getSchedule(scheduleId);
    if (!current) return null;
    const updated = {
      ...current,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    await putSchedule(updated);
    return updated;
  }

  async defaultExecutionHandler(schedule) {
    throw new Error(
      `Recurring execution is not wired for on-chain payments (schedule ${schedule?.id || "unknown"}).`
    );
  }

  async executeSchedule(scheduleId, now = new Date()) {
    const lock = await acquireScheduleLock(scheduleId);
    if (!lock) {
      return { skipped: true, reason: "locked", scheduleId };
    }

    try {
      const schedule = await getSchedule(scheduleId);
      if (!schedule) return { skipped: true, reason: "not-found", scheduleId };
      if (schedule.status !== "active") {
        return { skipped: true, reason: `status:${schedule.status}`, scheduleId };
      }

      const due = new Date(schedule.nextExecutionAt).getTime() <= now.getTime();
      if (!due) {
        return { skipped: true, reason: "not-due", scheduleId };
      }

      let working = schedule;
      const logs = [];
      try {
        let catchupLimited = false;

        for (let idx = 0; idx < this.maxCatchupPerRun; idx += 1) {
          const dueAt = new Date(working.nextExecutionAt);
          if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() > now.getTime()) {
            break;
          }
          const result = await this.executionHandler(working);
          const executedAt = new Date().toISOString();
          const nextExecutionAt = advanceExecutionDateOnce({
            frequency: working.frequency,
            customIntervalSeconds: working.customIntervalSeconds,
            fromDate: working.nextExecutionAt,
          });
          const updated = {
            ...working,
            retryCount: 0,
            lastExecutionAt: executedAt,
            lastFailureAt: null,
            failureReason: null,
            nextExecutionAt,
            updatedAt: executedAt,
          };
          await putSchedule(updated);

          const logEntry = {
            id: `log_${crypto.randomUUID()}`,
            scheduleId: updated.id,
            payerAddress: updated.payerAddress,
            tokenAddress: updated.tokenAddress,
            amount: updated.amount,
            status: "success",
            executedAt,
            scheduledFor: dueAt.toISOString(),
            result,
          };
          await appendPaymentLog(logEntry);
          logs.push(logEntry);
          working = updated;
        }

        catchupLimited =
          logs.length >= this.maxCatchupPerRun &&
          new Date(working.nextExecutionAt).getTime() <= now.getTime();
        if (!logs.length) {
          return { skipped: true, reason: "not-due", scheduleId };
        }
        return {
          schedule: working,
          log: logs[logs.length - 1],
          logs,
          catchupExecutions: logs.length,
          catchupLimited,
        };
      } catch (err) {
        const retryCount = Number(working.retryCount || 0) + 1;
        const maxRetries = Number(working.maxRetries || 5);
        const hardFailed = retryCount > maxRetries;
        const nowIso = now.toISOString();
        const updated = {
          ...working,
          retryCount,
          lastFailureAt: nowIso,
          failureReason: err?.message || String(err),
          status: hardFailed ? "failed" : "active",
          nextExecutionAt: hardFailed
            ? working.nextExecutionAt
            : buildRetryDate(
                now,
                retryCount,
                Number(working.retryBackoffSeconds || 60)
              ),
          updatedAt: nowIso,
        };
        await putSchedule(updated);

        const logEntry = {
          id: `log_${crypto.randomUUID()}`,
          scheduleId: working.id,
          payerAddress: working.payerAddress,
          tokenAddress: working.tokenAddress,
          amount: working.amount,
          status: hardFailed ? "failed" : "retry",
          executedAt: nowIso,
          error: updated.failureReason,
          retryCount,
          catchupExecutions: logs.length,
        };
        await appendPaymentLog(logEntry);
        return {
          schedule: updated,
          log: logEntry,
          logs: logs.length ? [...logs, logEntry] : [logEntry],
          catchupExecutions: logs.length,
        };
      }
    } finally {
      await releaseScheduleLock(lock);
    }
  }

  async runDuePayments(now = new Date()) {
    const all = await this.listSchedules();
    const due = all
      .filter((s) => s.status === "active")
      .filter((s) => new Date(s.nextExecutionAt).getTime() <= now.getTime())
      .slice(0, this.maxBatchSize);

    const results = await Promise.allSettled(
      due.map((s) => this.executeSchedule(s.id, now))
    );

    const summary = {
      checked: all.length,
      due: due.length,
      executed: 0,
      success: 0,
      retry: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    for (const r of results) {
      if (r.status === "rejected") {
        summary.errors += 1;
        summary.details.push({ status: "error", error: String(r.reason) });
        continue;
      }
      const v = r.value;
      if (v?.skipped) {
        summary.skipped += 1;
        summary.details.push(v);
      } else if (v?.log?.status === "success") {
        summary.success += 1;
        summary.executed += Number(v?.catchupExecutions || 1);
        summary.details.push(v);
      } else if (v?.log?.status === "retry") {
        summary.retry += 1;
        summary.executed += Number(v?.catchupExecutions || 0);
        summary.details.push(v);
      } else if (v?.log?.status === "failed") {
        summary.failed += 1;
        summary.executed += Number(v?.catchupExecutions || 0);
        summary.details.push(v);
      } else {
        summary.details.push(v);
      }
    }

    return summary;
  }
}

export function createRecurringPaymentEngine(options) {
  return new RecurringPaymentEngine(options);
}

