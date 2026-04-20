import { getArcpayAccessByAddress } from "../subscription-eligibility.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const owner = String(req.query?.owner || "").trim().toLowerCase();
    const access = await getArcpayAccessByAddress(owner);
    return res.status(200).json(access);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

