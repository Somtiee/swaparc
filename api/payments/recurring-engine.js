import { kv } from "@vercel/kv";
import { deriveStealthPayment } from "../../src/utils/stealthAddress.js";

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

export function computeNextExecutionDate({
  frequency,
  customIntervalSeconds,
  lastExecutionAt,
  startAt,
  now = new Date(),
}) {
  const f = String(frequency || "").toLowerCase();
  if (!SUPPORTED_FREQUENCIES.has(f)) {
    throw new Error(`Unsupported frequency: ${frequency}`);
  }

  const baseline = parseDate(lastExecutionAt, parseDate(startAt, now));
  const cursor = new Date(baseline);
  const nowDate = new Date(now);

  const advance = () => {
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
        return addMonthsSafe(cursor, 1);
      case "quarterly":
        return addMonthsSafe(cursor, 3);
      case "yearly":
        return addMonthsSafe(cursor, 12);
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
    return cursor;
  };

  let next = new Date(cursor);
  while (next.getTime() <= nowDate.getTime()) {
    next = new Date(advance());
  }
  return next.toISOString();
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
    "receiverSpendPublicKey",
    "receiverViewPublicKey",
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
  } = {}) {
    this.executionHandler = executionHandler || this.defaultExecutionHandler.bind(this);
    this.maxBatchSize = maxBatchSize;
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

  async listPaymentLogs(limit = 100) {
    return await listPaymentLogs(limit);
  }

  async defaultExecutionHandler(schedule) {
    // Stealth generation is deterministic per execution and creates a one-time address.
    const stealth = deriveStealthPayment({
      receiverSpendPublicKey: schedule.receiverSpendPublicKey,
      receiverViewPublicKey: schedule.receiverViewPublicKey,
    });

    return {
      paymentId: `pay_${crypto.randomUUID()}`,
      stealthAddress: stealth.stealthAddress,
      ephemeralPublicKey: stealth.ephemeralPublicKey,
      viewTag: stealth.viewTag,
      status: "submitted",
      txHash: null, // integrators can fill this with on-chain tx hash
    };
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

      try {
        const result = await this.executionHandler(schedule);
        const executedAt = now.toISOString();
        const nextExecutionAt = computeNextExecutionDate({
          frequency: schedule.frequency,
          customIntervalSeconds: schedule.customIntervalSeconds,
          lastExecutionAt: executedAt,
          startAt: schedule.startAt,
          now,
        });

        const updated = {
          ...schedule,
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
          scheduleId: schedule.id,
          payerAddress: schedule.payerAddress,
          tokenAddress: schedule.tokenAddress,
          amount: schedule.amount,
          status: "success",
          executedAt,
          result,
        };
        await appendPaymentLog(logEntry);
        return { schedule: updated, log: logEntry };
      } catch (err) {
        const retryCount = Number(schedule.retryCount || 0) + 1;
        const maxRetries = Number(schedule.maxRetries || 5);
        const hardFailed = retryCount > maxRetries;
        const nowIso = now.toISOString();
        const updated = {
          ...schedule,
          retryCount,
          lastFailureAt: nowIso,
          failureReason: err?.message || String(err),
          status: hardFailed ? "failed" : "active",
          nextExecutionAt: hardFailed
            ? schedule.nextExecutionAt
            : buildRetryDate(
                now,
                retryCount,
                Number(schedule.retryBackoffSeconds || 60)
              ),
          updatedAt: nowIso,
        };
        await putSchedule(updated);

        const logEntry = {
          id: `log_${crypto.randomUUID()}`,
          scheduleId: schedule.id,
          payerAddress: schedule.payerAddress,
          tokenAddress: schedule.tokenAddress,
          amount: schedule.amount,
          status: hardFailed ? "failed" : "retry",
          executedAt: nowIso,
          error: updated.failureReason,
          retryCount,
        };
        await appendPaymentLog(logEntry);
        return { schedule: updated, log: logEntry };
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
        summary.details.push(v);
      } else if (v?.log?.status === "retry") {
        summary.retry += 1;
        summary.details.push(v);
      } else if (v?.log?.status === "failed") {
        summary.failed += 1;
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

