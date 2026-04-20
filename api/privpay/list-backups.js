import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";

function normalizeAddress(a) {
  const s = String(a || "").trim();
  if (!s) throw new Error("Missing address");
  return ethers.getAddress(s).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const owner = normalizeAddress(req.query?.address);
    const rows = (await kv.get(`privpay:receiver:backups:${owner}`)) || [];
    const backups = Array.isArray(rows)
      ? rows.map((x) => ({
          keyId: x?.keyId,
          label: x?.label || "private-receive-keyring",
          createdAt: x?.createdAt || null,
          updatedAt: x?.updatedAt || null,
        }))
      : [];
    return res.status(200).json({ ok: true, address: owner, backups });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

