import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";
import {
  recurringScheduleExecutionHandler,
  maintainRecurringRelayerGasBestEffort,
  isAutopayPauseError,
  probeRecurringAutopayReadiness,
} from "../../../lib/server/recurringPrivpayExecution.js";
import { assertCronAuthStrict, assertOwnerAuth } from "../../security/walletAuth.js";
import { warmPrivacyPoolSnapshots } from "../../privpay/claim-context.js";

function hasAutomationAccess(access) {
  return !!(access?.payrollAutomation || access?.recurringPayments);
}

function serverExecutionEnabled() {
  return (
    String(process.env.RECURRING_SERVER_EXECUTION_ENABLED || "").toLowerCase() ===
    "true"
  );
}

/**
 * Serialize recurring bill execution per payer so overlapping POSTs (client tick + cron)
 * cannot duplicate executeSchedule for the same wallet (same failure mode as payroll/run).
 */
const recurringBillsRunChain =
  globalThis.__recurringBillsRunChain || (globalThis.__recurringBillsRunChain = new Map());

async function runSerializedForPayer(payerLower, fn) {
  const key = String(payerLower || "").trim().toLowerCase();
  if (!key.startsWith("0x")) {
    return fn();
  }
  const prev = recurringBillsRunChain.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn());
  recurringBillsRunChain.set(key, next);
  try {
    return await next;
  } finally {
    if (recurringBillsRunChain.get(key) === next) {
      recurringBillsRunChain.delete(key);
    }
  }
}

function tallyExecutionResult(v, counters) {
  if (v?.skipped) {
    counters.skipped += 1;
  } else if (v?.log?.status === "success") {
    counters.success += 1;
    counters.executed += Number(v?.catchupExecutions || 1);
  } else if (v?.log?.status === "retry") {
    counters.retry += 1;
    counters.executed += Number(v?.catchupExecutions || 0);
  } else if (v?.log?.status === "paused") {
    counters.paused += 1;
  } else if (v?.log?.status === "failed") {
    counters.failed += 1;
    counters.executed += Number(v?.catchupExecutions || 0);
  }
}

/**
 * Recovery pass over PAUSED schedules that are due: probe on-chain readiness
 * (payer balance + allowances). When the payer can pay again, resume the
 * schedule and execute (catch-up pays missed periods). Otherwise report the
 * paused row without counting a failure — it is re-checked on the next run.
 */
async function runPausedRecoveryPass(engine, pausedSchedules, counters, details) {
  for (const s of pausedSchedules) {
    try {
      const probe = await probeRecurringAutopayReadiness(s);
      if (!probe?.ready) {
        counters.paused += 1;
        details.push({
          scheduleId: s.id,
          paused: true,
          reasonCode: probe?.reasonCode || null,
          reason: probe?.reason || "Autopay paused — waiting to recover.",
        });
        continue;
      }
      await engine.resumeSchedule(s.id);
      const v = await engine.executeSchedule(s.id, new Date(), { force: false });
      details.push(v);
      tallyExecutionResult(v, counters);
    } catch (e) {
      counters.errors += 1;
      details.push({
        scheduleId: s.id,
        status: "error",
        error: e?.message || String(e),
      });
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Keep privacy-pool claim snapshots warm (self-throttled to 1/min, never
  // blocks the response) so claims never hit a cold 20M-block scan.
  warmPrivacyPoolSnapshots().catch(() => {});

  try {
    const executionEnabled = serverExecutionEnabled();
    const body = req.body || {};
    const owner = String(body?.owner || req.query?.owner || "").trim().toLowerCase();
    const engine = createRecurringPaymentEngine({
      executionHandler: recurringScheduleExecutionHandler,
      isPauseError: isAutopayPauseError,
    });
    let summary;

    if (owner) {
      // Owner-scoped runs move funds with the server relayer — they must prove
      // the caller controls `owner` (wallet signature or Circle session).
      await assertOwnerAuth(req, owner, "payments-recurring-run");
      const access = await getArcpayAccessByAddress(owner);
      if (!hasAutomationAccess(access)) {
        return res.status(402).json({
          ok: false,
          error: "Automation is not enabled for this wallet.",
          access,
        });
      }
      if (executionEnabled) {
        // Operator MY_PK tops up shared relayer gas before any wallet's due bills run.
        await maintainRecurringRelayerGasBestEffort();
      }
      summary = await runSerializedForPayer(owner, async () => {
        const now = new Date();
        const schedules = await engine.listSchedules();
        // forceScheduleIds is cron-only: an authenticated owner must not be able
        // to force-run a schedule that is not due yet.
        const due = schedules.filter((s) => {
          if (String(s?.payerAddress || "").toLowerCase() !== owner) return false;
          if (s?.status !== "active") return false;
          return new Date(s.nextExecutionAt).getTime() <= now.getTime();
        });
        const pausedDue = schedules.filter((s) => {
          if (String(s?.payerAddress || "").toLowerCase() !== owner) return false;
          if (s?.status !== "paused") return false;
          return new Date(s.nextExecutionAt).getTime() <= now.getTime();
        });
        if (!executionEnabled) {
          return {
            checked: schedules.length,
            due: due.length,
            executed: 0,
            success: 0,
            retry: 0,
            failed: 0,
            paused: 0,
            skipped: due.length,
            errors: 0,
            details: due.map((s) => ({
              scheduleId: s.id,
              skipped: true,
              reason: "server-execution-disabled",
              note:
                "Server-side recurring execution is disabled. Enable RECURRING_SERVER_EXECUTION_ENABLED=true only if your backend can sign transfers safely.",
            })),
          };
        }
        const details = [];
        const counters = {
          success: 0,
          retry: 0,
          failed: 0,
          paused: 0,
          skipped: 0,
          errors: 0,
          executed: 0,
        };
        // Sequential: same relayer signs every bill; parallel Promise.allSettled
        // caused nonce-too-low / NONCE_EXPIRED collisions across Water/EURC/USDC.
        for (const s of due) {
          try {
            const v = await engine.executeSchedule(s.id, now, { force: false });
            details.push(v);
            tallyExecutionResult(v, counters);
          } catch (e) {
            counters.errors += 1;
            details.push({ status: "error", error: e?.message || String(e) });
          }
        }
        // Paused rows: resume + pay when the wallet recovered, else report paused.
        await runPausedRecoveryPass(engine, pausedDue, counters, details);
        return {
          checked: schedules.length,
          due: due.length,
          executed: counters.executed,
          success: counters.success,
          retry: counters.retry,
          failed: counters.failed,
          paused: counters.paused,
          skipped: counters.skipped,
          errors: counters.errors,
          details,
        };
      });
    } else {
      assertCronAuthStrict(req);
      if (executionEnabled) {
        await maintainRecurringRelayerGasBestEffort();
      }
      const now = new Date();
      const schedules = await engine.listSchedules();
      const due = schedules.filter(
        (s) =>
          s?.status === "active" &&
          s?.payerAddress &&
          new Date(s.nextExecutionAt).getTime() <= now.getTime()
      );
      const pausedDue = schedules.filter(
        (s) =>
          s?.status === "paused" &&
          s?.payerAddress &&
          new Date(s.nextExecutionAt).getTime() <= now.getTime()
      );
      if (!executionEnabled) {
        summary = {
          checked: schedules.length,
          due: due.length,
          executed: 0,
          success: 0,
          retry: 0,
          failed: 0,
          paused: 0,
          skipped: due.length,
          errors: 0,
          details: due.map((s) => ({
            scheduleId: s.id,
            skipped: true,
            reason: "server-execution-disabled",
            note:
              "Server-side recurring execution is disabled. Enable RECURRING_SERVER_EXECUTION_ENABLED=true only if your backend can sign transfers safely.",
          })),
        };
        return res.status(200).json({ ok: true, summary });
      }

      const details = [];
      const counters = {
        success: 0,
        retry: 0,
        failed: 0,
        paused: 0,
        skipped: 0,
        errors: 0,
        executed: 0,
      };

      for (const schedule of due) {
        const payerKey = String(schedule.payerAddress || "").trim().toLowerCase();
        await runSerializedForPayer(payerKey, async () => {
          try {
            const access = await getArcpayAccessByAddress(payerKey);
            if (!hasAutomationAccess(access)) {
              counters.skipped += 1;
              details.push({
                scheduleId: schedule.id,
                skipped: true,
                reason: "subscription-locked",
                owner: schedule.payerAddress,
              });
              return;
            }
            const result = await engine.executeSchedule(schedule.id, now);
            details.push(result);
            tallyExecutionResult(result, counters);
          } catch (e) {
            counters.errors += 1;
            details.push({
              scheduleId: schedule.id,
              status: "error",
              error: e?.message || String(e),
            });
          }
        });
      }

      // Paused rows: resume + pay when the wallet recovered, else report paused.
      for (const schedule of pausedDue) {
        const payerKey = String(schedule.payerAddress || "").trim().toLowerCase();
        await runSerializedForPayer(payerKey, async () => {
          try {
            const access = await getArcpayAccessByAddress(payerKey);
            if (!hasAutomationAccess(access)) {
              counters.skipped += 1;
              details.push({
                scheduleId: schedule.id,
                skipped: true,
                reason: "subscription-locked",
                owner: schedule.payerAddress,
              });
              return;
            }
            await runPausedRecoveryPass(engine, [schedule], counters, details);
          } catch (e) {
            counters.errors += 1;
            details.push({
              scheduleId: schedule.id,
              status: "error",
              error: e?.message || String(e),
            });
          }
        });
      }

      summary = {
        checked: schedules.length,
        due: due.length,
        executed: counters.executed,
        success: counters.success,
        retry: counters.retry,
        failed: counters.failed,
        paused: counters.paused,
        skipped: counters.skipped,
        errors: counters.errors,
        details,
      };
    }

    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
