import { ethers } from "ethers";

export const SWAPARC_AUTH_DOMAIN = "Swaparc Auth";

export function buildSwaparcAuthMessage(action, address, timestampMs, nonce) {
  return [
    SWAPARC_AUTH_DOMAIN,
    `Action: ${action}`,
    `Address: ${ethers.getAddress(address)}`,
    `Timestamp: ${timestampMs}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/**
 * Authenticated fetch for owner-scoped API routes.
 * Wallet Connect: EIP-191 signature. Circle email: X-User-Token header.
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

  let auth;
  if (isCircleMode?.()) {
    const userToken = window.localStorage.getItem("circle_user_token");
    if (userToken) headers["X-User-Token"] = userToken;
    auth = { timestampMs, nonce };
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
    headers["X-Wallet-Address"] = owner.toLowerCase();
    headers["X-Wallet-Signature"] = walletSignature;
    headers["X-Auth-Timestamp"] = String(timestampMs);
    headers["X-Auth-Nonce"] = nonce;
  }

  const upper = String(method || "POST").toUpperCase();
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
