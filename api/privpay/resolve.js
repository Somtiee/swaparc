import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import { utils as secpUtils } from "@noble/secp256k1";

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
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const address = normalizeAddress(req.query?.address);
    const row = await kv.get(`privpay:receiver:${address}`);
    if (!row?.spendPublicKey || !row?.viewPublicKey) {
      return res.status(404).json({
        ok: false,
        error: "Recipient has not enabled private receive",
        address,
      });
    }
    let spendPublicKey;
    let viewPublicKey;
    try {
      spendPublicKey = normalizePublicKey(row.spendPublicKey, "spendPublicKey");
      viewPublicKey = normalizePublicKey(row.viewPublicKey, "viewPublicKey");
    } catch {
      return res.status(409).json({
        ok: false,
        error:
          "Recipient has stale/invalid private receive keys on record. Ask them to reconnect private receive.",
        address,
      });
    }
    return res.status(200).json({
      ok: true,
      receiver: {
        address,
        spendPublicKey,
        viewPublicKey,
      },
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

