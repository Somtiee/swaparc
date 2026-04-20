import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { kv } from "./kv.js";

const RELAY_NAME = "PrivPayPoolRelay";
const RELAY_VERSION = "1";

const MEMORY_RL =
  globalThis.__privpayRelayRateBuckets ||
  (globalThis.__privpayRelayRateBuckets = new Map());

export function relayChainId() {
  const n = Number(process.env.ARC_CHAIN_ID || process.env.CHAIN_ID || 5042002);
  return Number.isFinite(n) && n > 0 ? n : 5042002;
}

/**
 * @param {import("http").IncomingMessage} req
 */
export function relayClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    return xff.split(",")[0].trim() || "unknown";
  }
  const nx = /** @type {{ socket?: { remoteAddress?: string }}} */ (req);
  return String(nx.socket?.remoteAddress || "unknown");
}

function ipBucketDigest(ip, action) {
  const pepper = String(process.env.PRIVPAY_RELAY_RL_PEPPER || "privpay-relay-v1");
  return createHash("sha256")
    .update(`${pepper}:${ip}:${action}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * @param {string} ip
 * @param {"withdraw" | "deposit"} action
 */
export async function assertRelayRateLimit(ip, action) {
  const rpm = Math.max(5, Math.min(120, Number(process.env.PRIVPAY_RELAY_RPM || 30)));
  const minute = Math.floor(Date.now() / 60_000);
  const digest = ipBucketDigest(ip, action);
  const key = `privpay:relay:rl:${action}:${digest}:${minute}`;

  try {
    const n = await kv.incr(key);
    if (n === 1) {
      await kv.expire(key, 120);
    }
    if (n > rpm) {
      const err = new Error("Rate limit exceeded");
      err.status = 429;
      throw err;
    }
    return;
  } catch (e) {
    if (e?.status === 429) throw e;
    if (String(process.env.PRIVPAY_RELAY_REQUIRE_KV || "").trim() === "1") {
      const err = new Error("Rate limit store unavailable");
      err.status = 503;
      throw err;
    }
  }

  const memKey = `${digest}:${minute}`;
  const prev = MEMORY_RL.get(memKey) || 0;
  const next = prev + 1;
  MEMORY_RL.set(memKey, next);
  if (next > rpm) {
    const err = new Error("Rate limit exceeded");
    err.status = 429;
    throw err;
  }
  if (MEMORY_RL.size > 50_000) {
    for (const k of MEMORY_RL.keys()) {
      MEMORY_RL.delete(k);
      if (MEMORY_RL.size < 10_000) break;
    }
  }
}

/**
 * Optional second factor: if PRIVPAY_RELAY_SERVER_SECRET or PRIVACY_POOL_RELAY_SERVER_SECRET is set, require header match.
 * @param {import("http").IncomingMessage} req
 */
export function assertOptionalRelayServerSecret(req) {
  const sec = String(
    process.env.PRIVPAY_RELAY_SERVER_SECRET ||
      process.env.PRIVACY_POOL_RELAY_SERVER_SECRET ||
      ""
  ).trim();
  if (!sec) return;
  const sent = String(req.headers["x-privpay-relay-secret"] || "").trim();
  if (sent !== sec) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
}

function parseAllowedPools() {
  const explicit = String(process.env.PRIVPAY_ALLOWED_POOL_ADDRESSES || "").trim();
  const fallback = [
    process.env.PRIVACY_POOL_ADDRESS_USDC,
    process.env.PRIVACY_POOL_ADDRESS_EURC,
    process.env.PRIVACY_POOL_ADDRESS_SWPRC,
    process.env.VITE_PRIVACY_POOL_ADDRESS_USDC,
    process.env.VITE_PRIVACY_POOL_ADDRESS_EURC,
    process.env.VITE_PRIVACY_POOL_ADDRESS_SWPRC,
    process.env.PRIVACY_POOL_ADDRESS,
    process.env.VITE_PRIVACY_POOL_ADDRESS,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(",");
  const raw = explicit || fallback;
  if (!raw) return null;
  const parts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set();
  for (const p of parts) {
    try {
      set.add(ethers.getAddress(p).toLowerCase());
    } catch {
      /* skip invalid */
    }
  }
  return set.size ? set : null;
}

export function assertRelayPoolAllowed(poolAddress) {
  const allowed = parseAllowedPools();
  if (!allowed) {
    const err = new Error("Relay pool allowlist not configured");
    err.status = 503;
    throw err;
  }
  const addr = ethers.getAddress(poolAddress).toLowerCase();
  if (!allowed.has(addr)) {
    const err = new Error("Pool not allowed for this relay");
    err.status = 403;
    throw err;
  }
}

function relayDomain(poolAddress, chainId) {
  return {
    name: RELAY_NAME,
    version: RELAY_VERSION,
    chainId,
    verifyingContract: ethers.getAddress(poolAddress),
  };
}

const TYPES_WITHDRAW = {
  RelayWithdraw: [
    { name: "pool", type: "address" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const TYPES_DEPOSIT = {
  RelayDeposit: [
    { name: "pool", type: "address" },
    { name: "depositor", type: "address" },
    { name: "commitment", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const MAX_DEADLINE_DRIFT_SEC = Math.max(
  60,
  Math.min(3600, Number(process.env.PRIVPAY_RELAY_MAX_DEADLINE_SEC || 600))
);

function assertFreshDeadline(deadline) {
  const d = BigInt(String(deadline));
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (d <= now) {
    const err = new Error("Authorization expired");
    err.status = 400;
    throw err;
  }
  if (d > now + BigInt(MAX_DEADLINE_DRIFT_SEC)) {
    const err = new Error("Deadline too far in the future");
    err.status = 400;
    throw err;
  }
}

/**
 * @param {object} p
 */
export function verifyRelayWithdrawSignature(p) {
  const {
    poolAddress,
    chainId,
    nullifierHash,
    recipient,
    amountWei,
    deadline,
    signature,
  } = p;
  assertFreshDeadline(deadline);
  const domain = relayDomain(poolAddress, chainId);
  const value = {
    pool: ethers.getAddress(poolAddress),
    nullifierHash,
    recipient: ethers.getAddress(recipient),
    amount: amountWei,
    deadline,
  };
  const signer = ethers.verifyTypedData(domain, TYPES_WITHDRAW, value, signature);
  if (signer.toLowerCase() !== ethers.getAddress(recipient).toLowerCase()) {
    const err = new Error("Withdraw relay signature mismatch");
    err.status = 401;
    throw err;
  }
}

/**
 * @param {object} p
 */
export function verifyRelayDepositSignature(p) {
  const {
    poolAddress,
    chainId,
    depositor,
    commitment,
    amountWei,
    deadline,
    signature,
  } = p;
  assertFreshDeadline(deadline);
  const domain = relayDomain(poolAddress, chainId);
  const value = {
    pool: ethers.getAddress(poolAddress),
    depositor: ethers.getAddress(depositor),
    commitment,
    amount: amountWei,
    deadline,
  };
  const signer = ethers.verifyTypedData(domain, TYPES_DEPOSIT, value, signature);
  if (signer.toLowerCase() !== ethers.getAddress(depositor).toLowerCase()) {
    const err = new Error("Deposit relay signature mismatch");
    err.status = 401;
    throw err;
  }
}

/**
 * Safe diagnostics for logs (never include proofs, commitments, or full calldata).
 * @param {"withdraw" | "deposit"} action
 * @param {string} poolAddress
 */
export function relayLogHint(action, poolAddress) {
  let pool = "?";
  try {
    pool = ethers.getAddress(poolAddress).slice(0, 10);
  } catch {
    /* ignore */
  }
  return `${action} pool=${pool}…`;
}
