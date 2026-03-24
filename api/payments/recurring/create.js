import { createRecurringPaymentEngine } from "../recurring-engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const engine = createRecurringPaymentEngine();
    const schedule = await engine.createSchedule(req.body || {});
    return res.status(200).json({ ok: true, schedule });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

