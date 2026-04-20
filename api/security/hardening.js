import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kv } from "../../lib/server/kv.js";

const MEMORY_REPLAY =
  globalThis.__privpayReplayMemory || (globalThis.__privpayReplayMemory = new Map());

function keyMaterialFromEnv() {
  const raw = process.env.PRIVPAY_MASTER_KEY || process.env.CIRCLE_ENTITY_SECRET || "";
  if (!raw) {
    throw new Error("Missing PRIVPAY_MASTER_KEY for encryption");
  }
  return createHash("sha256").update(raw).digest();
}

export function secureRandomHex(byteLength = 16) {
  return `0x${randomBytes(Math.max(8, Number(byteLength) || 16)).toString("hex")}`;
}

export function requestDigestHex(payload) {
  const body = JSON.stringify(payload || {});
  return `0x${createHash("sha256").update(body).digest("hex")}`;
}

export function encryptJson(payload) {
  const key = keyMaterialFromEnv(); // 32 bytes
  const iv = randomBytes(12); // GCM nonce
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload || {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "AES-256-GCM",
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decryptJson(envelope) {
  const key = keyMaterialFromEnv();
  const iv = Buffer.from(String(envelope?.iv || ""), "hex");
  const tag = Buffer.from(String(envelope?.tag || ""), "hex");
  const ciphertext = Buffer.from(String(envelope?.ciphertext || ""), "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function assertNotExpired({
  requestTimestampMs,
  maxAgeMs = 120000,
}) {
  const ts = Number(requestTimestampMs || 0);
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new Error("Missing or invalid requestTimestampMs");
  }
  const age = Math.abs(Date.now() - ts);
  if (age > Number(maxAgeMs || 120000)) {
    throw new Error("Request expired");
  }
}

export async function assertReplayProtected({
  scope,
  idempotencyKey,
  digest,
  ttlSeconds = 600,
}) {
  const safeScope = String(scope || "privpay");
  const idem = String(idempotencyKey || "").trim().toLowerCase();
  const dg = String(digest || "").trim().toLowerCase();
  if (!idem) throw new Error("Missing idempotency key");
  if (!dg) throw new Error("Missing request digest");

  const replayKey = `privpay:replay:${safeScope}:${idem}:${dg}`;
  const value = `${Date.now()}:${secureRandomHex(8)}`;
  const ttl = Math.max(60, Number(ttlSeconds) || 600);

  let locked = false;
  try {
    locked = await kv.set(replayKey, value, { nx: true, ex: ttl });
  } catch {
    const existing = MEMORY_REPLAY.get(replayKey);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
      locked = false;
    } else {
      MEMORY_REPLAY.set(replayKey, { value, expiresAt: now + ttl * 1000 });
      locked = true;
    }
  }

  if (!locked) {
    const err = new Error("Replay detected: duplicate request");
    err.status = 409;
    throw err;
  }

  return { replayKey, idempotencyKey: idem, ttlSeconds: ttl };
}

