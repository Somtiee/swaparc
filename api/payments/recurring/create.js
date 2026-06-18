import { createRecurringPaymentEngine } from "../recurring-engine.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";
import { assertOwnerAuth } from "../../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const payerAddress = String(req.body?.payerAddress || "").trim().toLowerCase();
    if (!payerAddress || !payerAddress.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Valid payerAddress is required" });
    }
    await assertOwnerAuth(req, payerAddress, "payments-recurring-create");
    const access = await getArcpayAccessByAddress(payerAddress);
    if (!access?.recurringPayments) {
      return res.status(402).json({
        ok: false,
        error: "Recurring payments are not available for this wallet.",
        access,
      });
    }
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

