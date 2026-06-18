import { ethers } from "ethers";

export const SWAPARC_AUTH_DOMAIN = "Swaparc Auth";
export const WALLET_SESSION_ACTION = "wallet-session";
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Background sync — one wallet-session signature covers these (not per-request). */
export const WALLET_SESSION_ACTIONS = new Set([
  "wallet-session",
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

function sessionStorageKey(owner) {
  return `swaparc_wallet_session_${String(owner || "").toLowerCase()}`;
}

function readSessionCache(owner) {
  try {
    const raw = sessionStorage.getItem(sessionStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.walletSignature || Date.now() > Number(parsed.expiresAt || 0)) {
      sessionStorage.removeItem(sessionStorageKey(owner));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(owner, auth) {
  try {
    sessionStorage.setItem(
      sessionStorageKey(owner),
      JSON.stringify({ ...auth, expiresAt: Date.now() + SESSION_TTL_MS })
    );
  } catch {
    // ignore quota / private mode
  }
}

export function clearWalletSession(owner) {
  try {
    sessionStorage.removeItem(sessionStorageKey(String(owner || "").toLowerCase()));
  } catch {
    // ignore
  }
}

export function buildSwaparcAuthMessage(action, address, timestampMs, nonce) {
  return [
    SWAPARC_AUTH_DOMAIN,
    `Action: ${action}`,
    `Address: ${ethers.getAddress(address)}`,
    `Timestamp: ${timestampMs}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** One sign per browser session for background sync / reads (30 min). */
export async function establishWalletSession(ownerAddress, getSigner) {
  const owner = ethers.getAddress(String(ownerAddress || ""));
  const cached = readSessionCache(owner);
  if (cached) return cached;

  const timestampMs = Date.now();
  const nonce = crypto.randomUUID();
  const signer = await getSigner();
  const message = buildSwaparcAuthMessage(WALLET_SESSION_ACTION, owner, timestampMs, nonce);
  const walletSignature = await signer.signMessage(message);
  const auth = {
    timestampMs,
    nonce,
    walletSignature,
    walletAddress: owner.toLowerCase(),
    sessionAction: WALLET_SESSION_ACTION,
  };
  writeSessionCache(owner, auth);
  return auth;
}

function applyWalletAuthHeaders(headers, auth) {
  headers["X-Wallet-Address"] = auth.walletAddress;
  headers["X-Wallet-Signature"] = auth.walletSignature;
  headers["X-Auth-Timestamp"] = String(auth.timestampMs);
  headers["X-Auth-Nonce"] = auth.nonce;
}

/**
 * Authenticated fetch for owner-scoped API routes.
 * Wallet Connect: EIP-191 signature (session cached for background actions).
 * Circle email: X-User-Token header.
 */
export async function ownerApiFetch(url, {
  method = "POST",
  body,
  action,
  ownerAddress,
  isCircleMode,
  getSigner,
}) {
  const owner = ethers.getAddress(String(ownerAddress || ""));
  const timestampMs = Date.now();
  const nonce = crypto.randomUUID();
  const headers = { "Content-Type": "application/json" };
  const upper = String(method || "POST").toUpperCase();
  const useSession =
    upper === "GET" || upper === "HEAD" || WALLET_SESSION_ACTIONS.has(action);

  let auth;
  if (isCircleMode?.()) {
    const userToken = window.localStorage.getItem("circle_user_token");
    if (userToken) headers["X-User-Token"] = userToken;
    auth = { timestampMs, nonce };
  } else if (useSession) {
    auth = readSessionCache(owner);
    if (!auth) {
      auth = await establishWalletSession(owner, getSigner);
    }
    applyWalletAuthHeaders(headers, auth);
  } else {
    const signer = await getSigner();
    const message = buildSwaparcAuthMessage(action, owner, timestampMs, nonce);
    const walletSignature = await signer.signMessage(message);
    auth = {
      timestampMs,
      nonce,
      walletSignature,
      walletAddress: owner.toLowerCase(),
    };
    applyWalletAuthHeaders(headers, auth);
  }

  if (upper === "GET" || upper === "HEAD") {
    return fetch(url, { method: upper, headers });
  }

  const payload = { ...(body && typeof body === "object" ? body : {}), auth };
  return fetch(url, {
    method: upper,
    headers,
    body: JSON.stringify(payload),
  });
}
