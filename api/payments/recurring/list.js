import { createRecurringPaymentEngine } from "../recurring-engine.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const engine = createRecurringPaymentEngine();
    const [schedules, paymentLogs] = await Promise.all([
      engine.listSchedules(),
      engine.listPaymentLogs(200),
    ]);

    return res.status(200).json({
      ok: true,
      schedules,
      paymentLogs,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

