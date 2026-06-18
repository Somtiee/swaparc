import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";
import { recurringScheduleExecutionHandler } from "../../../lib/server/recurringPrivpayExecution.js";
import { assertCronAuthStrict, assertOwnerAuth } from "../../security/walletAuth.js";

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
    const engine = createRecurringPaymentEngine({
      executionHandler: recurringScheduleExecutionHandler,
    });
    let summary;

    if (owner) {
      if (executionEnabled) {
        await assertOwnerAuth(req, owner, "payments-recurring-run");
      }
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
        const due = schedules.filter(
          (s) =>
            String(s?.payerAddress || "").toLowerCase() === owner &&
            s?.status === "active" &&
            new Date(s.nextExecutionAt).getTime() <= now.getTime()
        );
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
        const results = await Promise.allSettled(
          due.map((s) => engine.executeSchedule(s.id, now))
        );
        const out = {
          checked: schedules.length,
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
            out.errors += 1;
            out.details.push({ status: "error", error: String(r.reason) });
            continue;
          }
          const v = r.value;
          if (v?.skipped) out.skipped += 1;
          else if (v?.log?.status === "success") {
            out.success += 1;
            out.executed += Number(v?.catchupExecutions || 1);
          } else if (v?.log?.status === "retry") {
            out.retry += 1;
            out.executed += Number(v?.catchupExecutions || 0);
          } else if (v?.log?.status === "failed") {
            out.failed += 1;
            out.executed += Number(v?.catchupExecutions || 0);
          }
          out.details.push(v);
        }
        return out;
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
