import { kv } from "../../../lib/server/kv.js";

// Intended for webhook/admin usage after offchain payment confirmation.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const adminSecret = process.env.SUBSCRIPTION_ADMIN_SECRET || "";
    const isVercelProduction = process.env.VERCEL_ENV === "production";
    if (isVercelProduction && !adminSecret) {
      return res.status(503).json({
        ok: false,
        error: "SUBSCRIPTION_ADMIN_SECRET must be set in production (webhook/checkout only).",
      });
    }
    if (adminSecret) {
      const provided = String(req.headers["x-subscription-secret"] || "");
      if (provided !== adminSecret) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
    }

    const owner = String(req.body?.owner || "").trim().toLowerCase();
    const months = Math.max(1, Number(req.body?.months || 1));
    if (!owner || !owner.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Valid owner wallet required" });
    }

    const base = new Date();
    const current = await kv.get(`privpay:subscription:${owner}`).catch(() => null);
    if (current?.expiresAt && new Date(current.expiresAt).getTime() > Date.now()) {
      base.setTime(new Date(current.expiresAt).getTime());
    }
    base.setUTCMonth(base.getUTCMonth() + months);

    const payload = {
      owner,
      plan: "monthly",
      status: "active",
      months,
      updatedAt: new Date().toISOString(),
      expiresAt: base.toISOString(),
    };
    await kv.set(`privpay:subscription:${owner}`, payload);
    return res.status(200).json({ ok: true, subscription: payload });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

