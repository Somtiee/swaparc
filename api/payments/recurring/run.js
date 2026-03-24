import { createRecurringPaymentEngine } from "../recurring-engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const engine = createRecurringPaymentEngine();
    const summary = await engine.runDuePayments(new Date());
    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

