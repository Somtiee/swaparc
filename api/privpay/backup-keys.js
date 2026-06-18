import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import {
  assertNotExpired,
  assertReplayProtected,
  requestDigestHex,
} from "../security/hardening.js";
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
    await assertIpRateLimit(req, "privpay-backup-keys", 15);
    const {
      address,
      keyId,
      label,
      backup,
      requestTimestampMs,
      requestNonce,
      idempotencyKey,
    } = req.body || {};

    const owner = normalizeAddress(address);
    await assertOwnerAuth(req, owner, "privpay-backup-keys");
    if (!keyId || !backup || typeof backup !== "object") {
      return res.status(400).json({
        ok: false,
        error: "keyId and backup payload are required",
      });
    }

    assertNotExpired({ requestTimestampMs, maxAgeMs: 120000 });
    const digest = requestDigestHex({
      owner,
      keyId,
      label,
      requestNonce,
      backupVersion: backup?.version || "v1",
      backupSalt: backup?.kdf?.salt || "",
      backupIv: backup?.cipher?.iv || "",
      backupLength: String(backup?.cipher?.ciphertext || "").length,
    });
    await assertReplayProtected({
      scope: "privpay-backup-keys",
      idempotencyKey: idempotencyKey || `${owner}:${keyId}`,
      digest,
      ttlSeconds: 900,
    });

    const listKey = `privpay:receiver:backups:${owner}`;
    const existing = (await kv.get(listKey)) || [];
    const nowIso = new Date().toISOString();
    const next = Array.isArray(existing) ? [...existing] : [];

    const row = {
      keyId: String(keyId),
      label: String(label || "private-receive-keyring"),
      createdAt: nowIso,
      updatedAt: nowIso,
      backup,
    };

    const idx = next.findIndex((x) => x?.keyId === row.keyId);
    if (idx >= 0) {
      row.createdAt = next[idx]?.createdAt || nowIso;
      next[idx] = row;
    } else {
      next.unshift(row);
    }

    // Keep only recent backups to cap storage.
    const capped = next.slice(0, 20);
    await kv.set(listKey, capped);

    return res.status(200).json({
      ok: true,
      backups: capped.map((x) => ({
        keyId: x.keyId,
        label: x.label,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
      })),
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

