import { kv } from "../../../lib/server/kv.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";

const MEMORY = globalThis.__privpayPayrollMemory || (globalThis.__privpayPayrollMemory = {});
const OWNER_SET = "privpay:payroll:owners";
const MEMORY_OWNERS =
  globalThis.__privpayPayrollOwners || (globalThis.__privpayPayrollOwners = new Set());

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.body?.owner || "").trim().toLowerCase();
    if (!ownerRaw) {
      return res.status(400).json({ ok: false, error: "Missing owner in body" });
    }

    const access = await getArcpayAccessByAddress(ownerRaw);
    if (!access?.payrollAutomation) {
      return res.status(402).json({
        ok: false,
        error: "Payroll automation is not available for this wallet.",
        access,
      });
    }

    const rawState = req.body?.state || {};
    let state;
    try {
      state = JSON.parse(
        JSON.stringify({
          companies: Array.isArray(rawState.companies) ? rawState.companies : [],
          employees: Array.isArray(rawState.employees) ? rawState.employees : [],
          history: Array.isArray(rawState.history) ? rawState.history.slice(0, 1000) : [],
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      return res.status(400).json({
        ok: false,
        error: "Payroll state could not be saved (invalid or non-JSON-safe data).",
      });
    }

    const key = `privpay:payroll:state:${ownerRaw}`;
    try {
      await kv.set(key, state);
      await kv.sadd(OWNER_SET, ownerRaw);
    } catch {
      MEMORY[key] = state;
      MEMORY_OWNERS.add(ownerRaw);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

