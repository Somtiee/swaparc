import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import { utils as secpUtils } from "@noble/secp256k1";
import { assertOwnerAuth, assertIpRateLimit } from "../security/walletAuth.js";

function normalizeAddress(a) {
  const s = String(a || "").trim();
  if (!s) throw new Error("Missing address");
  return ethers.getAddress(s).toLowerCase();
}

function normalizePublicKey(key, label) {
  const raw = String(key || "").trim();
  if (!raw) throw new Error(`${label} is required`);
  const prefixed = raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  let bytes;
  try {
    bytes = ethers.getBytes(prefixed);
  } catch {
    throw new Error(`${label} is invalid hex`);
  }
  if (bytes.length !== 33 && bytes.length !== 65) {
    throw new Error(`${label} must be 33-byte or 65-byte public key`);
  }
  if (!secpUtils.isValidPublicKey(bytes)) {
    throw new Error(`${label} is not a valid secp256k1 point`);
  }
  return ethers.hexlify(bytes);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    await assertIpRateLimit(req, "privpay-register-receiver", 20);
    const {
      address,
      spendPublicKey,
      viewPublicKey,
      encryptedSpendPrivateKey,
      encryptedViewPrivateKey,
      source = "app-connect",
    } = req.body || {};

    const owner = normalizeAddress(address);
    await assertOwnerAuth(req, owner, "privpay-register-receiver");
    if (!spendPublicKey || !viewPublicKey) {
      return res.status(400).json({
        ok: false,
        error: "spendPublicKey and viewPublicKey are required",
      });
    }
    const normalizedSpend = normalizePublicKey(spendPublicKey, "spendPublicKey");
    const normalizedView = normalizePublicKey(viewPublicKey, "viewPublicKey");

    const payload = {
      address: owner,
      spendPublicKey: normalizedSpend,
      viewPublicKey: normalizedView,
      encryptedSpendPrivateKey: encryptedSpendPrivateKey || null,
      encryptedViewPrivateKey: encryptedViewPrivateKey || null,
      source: String(source),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`privpay:receiver:${owner}`, payload);
    return res.status(200).json({
      ok: true,
      receiver: {
        address: owner,
        spendPublicKey: payload.spendPublicKey,
        viewPublicKey: payload.viewPublicKey,
      },
    });
  } catch (e) {
    return res.status(e?.status || 400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

