import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import { assertOwnerAuth, assertIpRateLimit } from "../security/walletAuth.js";

function normalizeAddress(a) {
  const s = String(a || "").trim();
  if (!s) throw new Error("Missing address");
  return ethers.getAddress(s).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    await assertIpRateLimit(req, "privpay-recover-keys", 10);
    const owner = normalizeAddress(req.body?.address);
    await assertOwnerAuth(req, owner, "privpay-recover-keys");
    const keyId = String(req.body?.keyId || "").trim();
    if (!keyId) {
      return res.status(400).json({ ok: false, error: "keyId is required" });
    }

    const rows = (await kv.get(`privpay:receiver:backups:${owner}`)) || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ ok: false, error: "No backups found" });
    }
    const row = rows.find((x) => x?.keyId === keyId);
    if (!row?.backup) {
      return res.status(404).json({ ok: false, error: "Backup not found for keyId" });
    }

    return res.status(200).json({
      ok: true,
      address: owner,
      keyId,
      label: row.label || "private-receive-keyring",
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
      backup: row.backup,
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

