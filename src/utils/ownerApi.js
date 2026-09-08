import { ethers } from "ethers";

export const SWAPARC_AUTH_DOMAIN = "Swaparc Auth";
export const WALLET_SESSION_ACTION = "wallet-session";

/** Must mirror WALLET_SESSION_ALLOWED_ACTIONS in api/security/walletAuth.js. */
export const WALLET_SESSION_ALLOWED_ACTIONS = new Set([
  "payments-bills-get",
  "payments-bills-save",
  "payments-payroll-get",
  "payments-payroll-save",
  "payments-payroll-run",
  "payments-recurring-list",
  "payments-recurring-run",
  "privpay-history-get",
  "privpay-history-save",
  "privpay-list-backups",
  "privpay-register-receiver",
  "profile-save",
  "profile-add-swap",
  "profile-update-lp",
]);

// Server accepts wallet-session signatures for 24 hours; refresh a bit earlier.
// Cached in localStorage (survives browser restarts) so wallet users sign
// once a day at most, not once per tab.
const SESSION_TTL_MS = 23 * 60 * 60 * 1000;

export function buildSwaparcAuthMessage(action, address, timestampMs, nonce) {
  return [
    SWAPARC_AUTH_DOMAIN,
    `Action: ${action}`,
    `Address: ${ethers.getAddress(address)}`,
    `Timestamp: ${timestampMs}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function sessionKey(owner) {
  return `swaparc_wallet_session_${String(owner || "").toLowerCase()}`;
}

function sessionStore() {
  // localStorage keeps the session across tabs and restarts; fall back to
  // sessionStorage when storage is blocked (private mode).
  try {
    window.localStorage.getItem("__probe__");
    return window.localStorage;
  } catch {
    return window.sessionStorage;
  }
}

function loadSessionSignature(owner) {
  try {
    const store = sessionStore();
    const raw = store.getItem(sessionKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed?.walletSignature ||
      !parsed?.nonce ||
      !Number.isFinite(Number(parsed.timestampMs)) ||
      Date.now() - Number(parsed.timestampMs) > SESSION_TTL_MS
    ) {
      store.removeItem(sessionKey(owner));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeSessionSignature(owner, fields) {
  try {
    sessionStore().setItem(sessionKey(owner), JSON.stringify(fields));
  } catch {
    // storage unavailable — just don't cache
  }
}

// One in-flight signature per owner: sign-in fires several session-allowed
// calls in parallel and each used to pop its own wallet prompt before the
// first signature landed in the cache. They now share a single popup.
const sessionSignInFlight = new Map();

async function getSessionSignature(owner, getSigner) {
  const cached = loadSessionSignature(owner);
  if (cached) return cached;

  let pending = sessionSignInFlight.get(owner);
  if (!pending) {
    pending = (async () => {
      const signer = await getSigner();
      const timestampMs = Date.now();
      const nonce = crypto.randomUUID();
      const message = buildSwaparcAuthMessage(
        WALLET_SESSION_ACTION,
        owner,
        timestampMs,
        nonce
      );
      const fields = {
        walletSignature: await signer.signMessage(message),
        timestampMs,
        nonce,
        walletAddress: owner.toLowerCase(),
      };
      storeSessionSignature(owner, fields);
      return fields;
    })().finally(() => {
      sessionSignInFlight.delete(owner);
    });
    sessionSignInFlight.set(owner, pending);
  }
  return pending;
}

export function clearWalletSession(owner) {
  try {
    window.localStorage.removeItem(sessionKey(owner));
    window.sessionStorage.removeItem(sessionKey(owner));
  } catch {
    // ignore
  }
}

function authHeaders(owner, fields) {
  return {
    "X-Wallet-Address": owner.toLowerCase(),
    "X-Wallet-Signature": fields.walletSignature,
    "X-Auth-Timestamp": String(fields.timestampMs),
    "X-Auth-Nonce": fields.nonce,
  };
}

/**
 * Owner-scoped API fetch. Circle (email login): attaches X-User-Token —
 * email users are NEVER asked for a wallet signature. Wallet connect:
 * sensitive actions get a fresh per-action signature (one wallet popup),
 * background/sync actions reuse a cached wallet-session signature.
 *
 * `isEmailAuth` (authMode === "email") is authoritative even when the
 * Circle wallet object is still loading: during the login race the old
 * check fell through to MetaMask signing and popped "privpay" signature
 * requests at gmail users on every login.
 */
export async function ownerApiFetch(url, {
  method = "POST",
  body,
  action,
  ownerAddress,
  isCircleMode,
  isEmailAuth,
  getSigner,
  walletSign = true,
}) {
  const headers = { "Content-Type": "application/json" };
  const upper = String(method || "POST").toUpperCase();
  let authFields = null;

  if (isCircleMode?.() || isEmailAuth) {
    const userToken = window.localStorage.getItem("circle_user_token");
    if (userToken) headers["X-User-Token"] = userToken;
    // No token yet (login still in flight): send unauthenticated — the
    // server rejects and the caller retries after login settles. Never
    // fall through to wallet signing for email users.
  } else if (walletSign && getSigner) {
    const owner = ethers.getAddress(String(ownerAddress || ""));
    const actionName = action || "wallet-action";
    const sessionAllowed = WALLET_SESSION_ALLOWED_ACTIONS.has(actionName);

    if (sessionAllowed) {
      // One popup per ~25 min: sign a reusable session message (shared
      // across parallel calls).
      authFields = await getSessionSignature(owner, getSigner);
    } else {
      // Sensitive action — fresh signature bound to this exact action.
      const signer = await getSigner();
      const timestampMs = Date.now();
      const nonce = crypto.randomUUID();
      const message = buildSwaparcAuthMessage(actionName, owner, timestampMs, nonce);
      authFields = {
        walletSignature: await signer.signMessage(message),
        timestampMs,
        nonce,
        walletAddress: owner.toLowerCase(),
      };
    }
    Object.assign(headers, authHeaders(owner, authFields));
  }

  if (upper === "GET" || upper === "HEAD") {
    return fetch(url, { method: upper, headers });
  }

  const finalBody =
    authFields || (body && typeof body === "object")
      ? {
          ...(body && typeof body === "object" ? body : {}),
          ...(authFields
            ? {
                auth: {
                  timestampMs: authFields.timestampMs,
                  nonce: authFields.nonce,
                  walletSignature: authFields.walletSignature,
                  walletAddress: authFields.walletAddress,
                },
              }
            : {}),
        }
      : {};

  return fetch(url, {
    method: upper,
    headers,
    body: JSON.stringify(finalBody),
  });
}
