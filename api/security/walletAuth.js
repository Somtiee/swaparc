import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { kv } from "../../lib/server/kv.js";
import { assertNotExpired } from "./hardening.js";
import { circleUserRequest } from "../circle/_circleUserApi.js";
import {
  swapPoolAllowlistAddresses,
} from "../../lib/swapPoolConfig.js";
import { getRelayAllowedPoolSet } from "../../lib/server/privpayRelayCore.js";

const AUTH_DOMAIN = "Swaparc Auth";
const WALLET_SESSION_ACTION = "wallet-session";
const WALLET_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Endpoints that accept a cached wallet-session signature (background sync / reads). */
export const WALLET_SESSION_ALLOWED_ACTIONS = new Set([
  "payments-bills-get",
  "payments-bills-save",
  "payments-payroll-get",
  "payments-payroll-save",
  "payments-recurring-list",
  "privpay-history-get",
  "privpay-history-save",
  "profile-save",
  "profile-add-swap",
]);
const MEMORY_RL =
  globalThis.__swaparcRateBuckets || (globalThis.__swaparcRateBuckets = new Map());

export function isProductionEnv() {
  return (
    process.env.VERCEL_ENV === "production" ||
    String(process.env.NODE_ENV || "").toLowerCase() === "production"
  );
}

export function requireOwnerAuth() {
  // Off by default — set SWAPARC_REQUIRE_OWNER_AUTH=1 when ready for strict mode.
  return String(process.env.SWAPARC_REQUIRE_OWNER_AUTH || "").trim() === "1";
}

export function buildSwaparcAuthMessage(action, address, timestampMs, nonce) {
  return [
    AUTH_DOMAIN,
    `Action: ${action}`,
    `Address: ${ethers.getAddress(address)}`,
    `Timestamp: ${timestampMs}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function unauthorized(message = "Unauthorized") {
  const err = new Error(message);
  err.status = 401;
  return err;
}

function readAuthFields(req) {
  const bodyAuth = req.body?.auth && typeof req.body.auth === "object" ? req.body.auth : {};
  const h = req.headers || {};
  return {
    walletSignature: String(
      bodyAuth.walletSignature || h["x-wallet-signature"] || ""
    ).trim(),
    timestampMs: Number(bodyAuth.timestampMs || h["x-auth-timestamp"] || 0),
    nonce: String(bodyAuth.nonce || h["x-auth-nonce"] || "").trim(),
    walletAddress: String(
      bodyAuth.walletAddress || h["x-wallet-address"] || ""
    )
      .trim()
      .toLowerCase(),
    userToken: String(h["x-user-token"] || bodyAuth.userToken || "").trim(),
  };
}

async function circleTokenOwnsAddress(userToken, ownerLower) {
  const data = await circleUserRequest({
    path: "/v1/w3s/wallets",
    method: "GET",
    userToken,
  });
  const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
  return wallets.some(
    (w) => String(w?.address || "").toLowerCase() === ownerLower
  );
}

function verifyWalletAuthMessage(fields, owner, signedAction, maxAgeMs) {
  assertNotExpired({ requestTimestampMs: fields.timestampMs, maxAgeMs });
  if (!fields.nonce) throw unauthorized("Missing auth nonce");
  const claimed = fields.walletAddress
    ? ethers.getAddress(fields.walletAddress).toLowerCase()
    : owner;
  if (claimed !== owner) throw unauthorized("Wallet address mismatch");
  const message = buildSwaparcAuthMessage(
    signedAction,
    owner,
    fields.timestampMs,
    fields.nonce
  );
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, fields.walletSignature).toLowerCase();
  } catch {
    throw unauthorized("Invalid wallet signature");
  }
  if (recovered !== owner) throw unauthorized("Wallet signature mismatch");
}

export async function assertOwnerAuth(req, ownerAddress, action) {
  const owner = ethers.getAddress(String(ownerAddress || "")).toLowerCase();
  const fields = readAuthFields(req);

  if (fields.userToken) {
    try {
      const ok = await circleTokenOwnsAddress(fields.userToken, owner);
      if (!ok) throw unauthorized("Circle session does not control this wallet");
      return { mode: "circle", owner };
    } catch (e) {
      if (e?.status === 401) throw e;
      throw unauthorized(e?.message || "Invalid Circle session");
    }
  }

  if (fields.walletSignature) {
    try {
      verifyWalletAuthMessage(fields, owner, action, 120_000);
      return { mode: "wallet", owner };
    } catch (exactErr) {
      if (
        WALLET_SESSION_ALLOWED_ACTIONS.has(action) &&
        exactErr?.message !== "Request expired"
      ) {
        try {
          verifyWalletAuthMessage(
            fields,
            owner,
            WALLET_SESSION_ACTION,
            WALLET_SESSION_MAX_AGE_MS
          );
          return { mode: "wallet-session", owner };
        } catch {
          throw exactErr;
        }
      }
      throw exactErr;
    }
  }

  if (requireOwnerAuth()) {
    throw unauthorized("Wallet or Circle session authentication required");
  }
  return { mode: "none", owner };
}

export function assertCronAuthStrict(req) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    if (isProductionEnv()) {
      const err = new Error("CRON_SECRET must be set in production");
      err.status = 503;
      throw err;
    }
    return;
  }
  const authHeader = String(req.headers.authorization || "");
  if (authHeader !== `Bearer ${cronSecret}`) {
    throw unauthorized();
  }
}

export async function assertIpRateLimit(req, scope, rpm = 30) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  const ip = xff ? xff.split(",")[0].trim() : String(req.socket?.remoteAddress || "unknown");
  const limit = Math.max(5, Math.min(120, Number(rpm) || 30));
  const minute = Math.floor(Date.now() / 60_000);
  const pepper = String(process.env.SWAPARC_RL_PEPPER || "swaparc-rl-v1");
  const digest = createHash("sha256")
    .update(`${pepper}:${scope}:${ip}:${minute}`)
    .digest("hex")
    .slice(0, 32);
  const key = `swaparc:rl:${scope}:${digest}:${minute}`;

  try {
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, 120);
    if (n > limit) {
      const err = new Error("Rate limit exceeded");
      err.status = 429;
      throw err;
    }
    return;
  } catch (e) {
    if (e?.status === 429) throw e;
  }

  const memKey = `${scope}:${digest}:${minute}`;
  const prev = MEMORY_RL.get(memKey) || 0;
  const next = prev + 1;
  MEMORY_RL.set(memKey, next);
  if (next > limit) {
    const err = new Error("Rate limit exceeded");
    err.status = 429;
    throw err;
  }
}

export function sanitizeUsername(value) {
  const s = String(value ?? "").trim().slice(0, 64);
  if (!s) return "";
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export function sanitizeAvatar(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length > 600_000) return "";
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) {
    return s.slice(0, 600_000);
  }
  if (/^https?:\/\/[^\s"'()<>]+$/i.test(s) && s.length <= 2048) {
    return s;
  }
  return "";
}

export function buildContractAllowlist() {
  const keys = [
    "VITE_SWAP_POOL_ADDRESS",
    "SWAP_POOL_ADDRESS",
    "VITE_STEALTH_PAYMENTS_ADDRESS",
    "STEALTH_PAYMENTS_ADDRESS",
    "VITE_PRIVACY_POOL_ADDRESS",
    "VITE_PRIVACY_POOL_ADDRESS_USDC",
    "VITE_PRIVACY_POOL_ADDRESS_EURC",
    "VITE_PRIVACY_POOL_ADDRESS_SWPRC",
    "PRIVACY_POOL_ADDRESS_USDC",
    "PRIVACY_POOL_ADDRESS_EURC",
    "PRIVACY_POOL_ADDRESS_SWPRC",
    "VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS",
    "RECURRING_AUTOMATION_CONTRACT_ADDRESS",
    "VITE_PRIVPAY_USDC_ADDRESS",
    "VITE_PRIVPAY_TREASURY_ADDRESS",
    "VITE_ARCPAY_USDC_ADDRESS",
    "VITE_ARCPAY_TREASURY_ADDRESS",
    "PRIVPAY_USDC_ADDRESS",
    "ARCPAY_USDC_ADDRESS",
    "ARCPAY_TREASURY_ADDRESS",
    "PRIVPAY_ALLOWED_POOL_ADDRESSES",
    "PRIVACY_POOL_VERIFIER_ADDRESS",
    "POSEIDON_T3_LIBRARY_ADDRESS",
  ];
  const extraPrefixes = ["VITE_", "PRIVPAY_", "ARCPAY_", "PRIVACY_POOL_", "SWAP_POOL_"];
  const extraSuffixes = ["_ADDRESS", "_CONTRACT_ADDRESS"];
  for (const key of Object.keys(process.env)) {
    if (!extraPrefixes.some((p) => key.startsWith(p))) continue;
    if (!extraSuffixes.some((s) => key.endsWith(s)) && !key.includes("POOL")) continue;
    keys.push(key);
  }
  const out = new Set();
  for (const addr of swapPoolAllowlistAddresses()) {
    out.add(addr);
  }
  for (const addr of getRelayAllowedPoolSet()) {
    out.add(addr);
  }
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (!v) continue;
    if (k === "PRIVPAY_ALLOWED_POOL_ADDRESSES") {
      for (const part of v.split(/[,\s]+/)) {
        const p = part.trim();
        if (p.startsWith("0x") && p.length === 42) {
          try {
            out.add(ethers.getAddress(p).toLowerCase());
          } catch {
            // skip invalid
          }
        }
      }
      continue;
    }
    if (v.startsWith("0x") && v.length === 42) {
      try {
        out.add(ethers.getAddress(v).toLowerCase());
      } catch {
        // skip invalid
      }
    }
  }
  return out;
}

export function assertContractAllowed(contractAddress, allowlist) {
  const list = allowlist || buildContractAllowlist();
  if (!list.size) return;
  let normalized;
  try {
    normalized = ethers.getAddress(String(contractAddress || "")).toLowerCase();
  } catch {
    const err = new Error("Invalid contract address");
    err.status = 400;
    throw err;
  }
  if (!list.has(normalized)) {
    const err = new Error("Contract address is not allowlisted");
    err.status = 403;
    err.code = "CONTRACT_NOT_ALLOWLISTED";
    throw err;
  }
}
