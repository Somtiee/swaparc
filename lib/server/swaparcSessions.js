/**
 * SwapArc persistent sessions for email (Circle) users.
 *
 * Circle userTokens expire after ~60 minutes, which used to force an
 * email+OTP login on nearly every visit. At Circle login the app mints a
 * SwapArc session id instead: a random bearer token stored in KV, bound to
 * one owner address, valid until the user disconnects (revoked) or it goes
 * unused for SESSION_TTL_SEC (hygiene cap). Owner-scoped API endpoints
 * accept it via assertOwnerAuth — see api/security/walletAuth.js.
 */
import { randomUUID } from "node:crypto";
import { kv } from "./kv.js";

const SESSION_PREFIX = "swaparc:session:";
// "Until disconnect" in practice: 180 days without a restore/refresh.
export const SESSION_TTL_SEC = 180 * 24 * 60 * 60;

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(sessionId) {
  return SESSION_ID_RE.test(String(sessionId || "").trim());
}

function sessionKey(sessionId) {
  return `${SESSION_PREFIX}${String(sessionId).trim().toLowerCase()}`;
}

/** Mint a new session bound to one owner address. Returns the stored record. */
export async function createSwaparcSession({ owner, walletId, blockchain, email }) {
  const normalizedOwner = String(owner || "").trim().toLowerCase();
  if (!normalizedOwner.startsWith("0x") || normalizedOwner.length !== 42) {
    const err = new Error("Invalid owner address for session");
    err.status = 400;
    throw err;
  }
  const sessionId = randomUUID();
  const record = {
    sessionId,
    owner: normalizedOwner,
    walletId: String(walletId || ""),
    blockchain: String(blockchain || ""),
    email: String(email || ""),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  await kv.set(sessionKey(sessionId), record, { ex: SESSION_TTL_SEC });
  return record;
}

/** Look up a session; null when unknown, revoked or malformed. */
export async function getSwaparcSession(sessionId) {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const record = await kv.get(sessionKey(sessionId));
    if (!record || typeof record !== "object") return null;
    const owner = String(record.owner || "").toLowerCase();
    if (!owner.startsWith("0x") || owner.length !== 42) return null;
    return record;
  } catch {
    return null;
  }
}

/** Touch a session's recency and roll its inactivity window. */
export async function touchSwaparcSession(sessionId) {
  if (!isValidSessionId(sessionId)) return;
  try {
    await kv.expire(sessionKey(sessionId), SESSION_TTL_SEC);
  } catch {
    // best-effort
  }
}

/** Revoke a session (explicit disconnect). Idempotent. */
export async function revokeSwaparcSession(sessionId) {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const n = await kv.del(sessionKey(sessionId));
    return n > 0;
  } catch {
    return false;
  }
}
