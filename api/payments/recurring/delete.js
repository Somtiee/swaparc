import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { assertOwnerAuth } from "../../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const scheduleId = String(req.body?.id || "").trim();
    const payerAddress = String(req.body?.payerAddress || "")
      .trim()
      .toLowerCase();
    if (!scheduleId) {
      return res.status(400).json({ ok: false, error: "Schedule id is required" });
    }
    if (!payerAddress || !payerAddress.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Valid payerAddress is required" });
    }
    await assertOwnerAuth(req, payerAddress, "payments-recurring-delete");

    const engine = createRecurringPaymentEngine();
    const current = await engine.getScheduleById(scheduleId);
    if (!current) {
      return res.status(404).json({ ok: false, error: "Schedule not found" });
    }
    if (String(current.payerAddress || "").toLowerCase() !== payerAddress) {
      return res.status(403).json({ ok: false, error: "Schedule owner mismatch" });
    }

    const schedule = await engine.cancelSchedule(scheduleId);
    return res.status(200).json({ ok: true, schedule });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
