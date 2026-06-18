import { ethers } from "ethers";

export const SWAPARC_AUTH_DOMAIN = "Swaparc Auth";
export const WALLET_SESSION_ACTION = "wallet-session";

export function buildSwaparcAuthMessage(action, address, timestampMs, nonce) {
  return [
    SWAPARC_AUTH_DOMAIN,
    `Action: ${action}`,
    `Address: ${ethers.getAddress(address)}`,
    `Timestamp: ${timestampMs}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function clearWalletSession(owner) {
  try {
    sessionStorage.removeItem(`swaparc_wallet_session_${String(owner || "").toLowerCase()}`);
  } catch {
    // ignore
  }
}

/**
 * Owner-scoped API fetch. Circle: attaches X-User-Token when present.
 * Wallet: plain fetch by default; pass walletSign=true only when strict auth is enabled.
 */
export async function ownerApiFetch(url, {
  method = "POST",
  body,
  action,
  ownerAddress,
  isCircleMode,
  getSigner,
  walletSign = false,
}) {
  const headers = { "Content-Type": "application/json" };
  const upper = String(method || "POST").toUpperCase();

  if (isCircleMode?.()) {
    const userToken = window.localStorage.getItem("circle_user_token");
    if (userToken) headers["X-User-Token"] = userToken;
  } else if (walletSign && getSigner) {
    const owner = ethers.getAddress(String(ownerAddress || ""));
    const timestampMs = Date.now();
    const nonce = crypto.randomUUID();
    const signer = await getSigner();
    const message = buildSwaparcAuthMessage(action || "wallet-action", owner, timestampMs, nonce);
    const walletSignature = await signer.signMessage(message);
    headers["X-Wallet-Address"] = owner.toLowerCase();
    headers["X-Wallet-Signature"] = walletSignature;
    headers["X-Auth-Timestamp"] = String(timestampMs);
    headers["X-Auth-Nonce"] = nonce;
    if (upper !== "GET" && upper !== "HEAD") {
      body = { ...(body && typeof body === "object" ? body : {}), auth: {
        timestampMs,
        nonce,
        walletSignature,
        walletAddress: owner.toLowerCase(),
      }};
    }
  }

  if (upper === "GET" || upper === "HEAD") {
    return fetch(url, { method: upper, headers });
  }

  return fetch(url, {
    method: upper,
    headers,
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
  });
}
