import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";
import {
  recurringScheduleExecutionHandler,
  maintainRecurringRelayerGasBestEffort,
} from "../../../lib/server/recurringPrivpayExecution.js";
import { assertCronAuthStrict } from "../../security/walletAuth.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const executionEnabled = serverExecutionEnabled();
    const body = req.body || {};
    const owner = String(body?.owner || req.query?.owner || "").trim().toLowerCase();
    if (executionEnabled) {
      // Operator MY_PK tops up shared relayer gas before any wallet's due bills run.
      await maintainRecurringRelayerGasBestEffort();
    }
    const engine = createRecurringPaymentEngine({
      executionHandler: recurringScheduleExecutionHandler,
    });
    let summary;

    if (owner) {
      const access = await getArcpayAccessByAddress(owner);
      if (!hasAutomationAccess(access)) {
        return res.status(402).json({
          ok: false,
          error: "Automation is not enabled for this wallet.",
          access,
        });
      }
      summary = await runSerializedForPayer(owner, async () => {
        const now = new Date();
        const schedules = await engine.listSchedules();
        const forceIds = new Set(
          (Array.isArray(body?.forceScheduleIds) ? body.forceScheduleIds : [])
            .map((id) => String(id || "").trim())
            .filter(Boolean)
        );
        const due = schedules.filter((s) => {
          if (String(s?.payerAddress || "").toLowerCase() !== owner) return false;
          if (s?.status !== "active") return false;
          if (forceIds.has(String(s.id))) return true;
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
        let success = 0;
        let retry = 0;
        let failed = 0;
        let skipped = 0;
        let errors = 0;
        let executed = 0;
        // Sequential: same relayer signs every bill; parallel Promise.allSettled
        // caused nonce-too-low / NONCE_EXPIRED collisions across Water/EURC/USDC.
        for (const s of due) {
          try {
            const v = await engine.executeSchedule(s.id, now, {
              force: forceIds.has(String(s.id)),
            });
            details.push(v);
            if (v?.skipped) skipped += 1;
            else if (v?.log?.status === "success") {
              success += 1;
              executed += Number(v?.catchupExecutions || 1);
            } else if (v?.log?.status === "retry") {
              retry += 1;
              executed += Number(v?.catchupExecutions || 0);
            } else if (v?.log?.status === "failed") {
              failed += 1;
              executed += Number(v?.catchupExecutions || 0);
            }
          } catch (e) {
            errors += 1;
            details.push({ status: "error", error: e?.message || String(e) });
          }
        }
        return {
          checked: schedules.length,
          due: due.length,
          executed,
          success,
          retry,
          failed,
          skipped,
          errors,
          details,
        };
      });
    } else {
      assertCronAuthStrict(req);
      const now = new Date();
      const schedules = await engine.listSchedules();
      const due = schedules.filter(
        (s) =>
          s?.status === "active" &&
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
      let success = 0;
      let retry = 0;
      let failed = 0;
      let skipped = 0;
      let errors = 0;
      let executed = 0;

      for (const schedule of due) {
        const payerKey = String(schedule.payerAddress || "").trim().toLowerCase();
        await runSerializedForPayer(payerKey, async () => {
          try {
            const access = await getArcpayAccessByAddress(payerKey);
            if (!hasAutomationAccess(access)) {
              skipped += 1;
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
            if (result?.skipped) skipped += 1;
            else if (result?.log?.status === "success") {
              success += 1;
              executed += Number(result?.catchupExecutions || 1);
            } else if (result?.log?.status === "retry") {
              retry += 1;
              executed += Number(result?.catchupExecutions || 0);
            } else if (result?.log?.status === "failed") {
              failed += 1;
              executed += Number(result?.catchupExecutions || 0);
            }
          } catch (e) {
            errors += 1;
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
        executed,
        success,
        retry,
        failed,
        skipped,
        errors,
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
