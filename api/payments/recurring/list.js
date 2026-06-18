import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { assertOwnerAuth } from "../../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const owner = String(req.query?.owner || "").trim().toLowerCase();
    if (!owner || !owner.startsWith("0x")) {
      return res.status(400).json({
        ok: false,
        error: "owner query param is required",
      });
    }
    await assertOwnerAuth(req, owner, "payments-recurring-list");
    const engine = createRecurringPaymentEngine();
    const [schedules, paymentLogs] = await Promise.all([
      engine.listSchedules(),
      engine.listPaymentLogs(200),
    ]);
    const filteredSchedules = schedules.filter(
      (s) => String(s?.payerAddress || "").toLowerCase() === owner
    );
    const scheduleIds = new Set(filteredSchedules.map((s) => s.id));
    const filteredLogs = paymentLogs.filter((log) =>
      scheduleIds.has(log?.scheduleId)
    );

    return res.status(200).json({
      ok: true,
      schedules: filteredSchedules,
      paymentLogs: filteredLogs,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

