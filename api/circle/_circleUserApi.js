import { ethers } from "ethers";

function getCircleConfig() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";
  if (!apiKey) throw new Error("Circle API key not configured");
  return { apiKey, baseUrl };
}

export async function circleUserRequest({
  path,
  method = "GET",
  userToken,
  body,
}) {
  if (!userToken) throw new Error("Missing userToken");
  const { apiKey, baseUrl } = getCircleConfig();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-User-Token": userToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.message || json?.error || "Circle API request failed";
    const err = new Error(message);
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json?.data || json || {};
}

export async function createCircleContractExecution({
  userToken,
  walletId,
  contractAddress,
  abiFunctionSignature,
  abiParameters,
  feeLevel = "MEDIUM",
  idempotencyKey,
}) {
  if (!walletId || !contractAddress || !abiFunctionSignature || !Array.isArray(abiParameters)) {
    throw new Error(
      "walletId, contractAddress, abiFunctionSignature and abiParameters[] are required"
    );
  }

  const requestBody = {
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    feeLevel,
  };

  const data = await circleUserRequest({
    path: "/v1/w3s/user/transactions/contractExecution",
    method: "POST",
    userToken,
    body: requestBody,
  });

  return {
    challengeId: data?.challengeId || null,
    transactionId:
      data?.id ||
      data?.transactionId ||
      data?.transaction?.id ||
      null,
    raw: data,
    requestBody,
  };
}

export async function createCircleTransferChallenge({
  userToken,
  walletId,
  destinationAddress,
  amount,
  feeLevel = "MEDIUM",
  idempotencyKey,
}) {
  if (!walletId || !destinationAddress || amount == null) {
    throw new Error("walletId, destinationAddress and amount are required");
  }
  const requestBody = {
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
    walletId,
    destinationAddress,
    amounts: [String(amount)],
    feeLevel,
  };
  const data = await circleUserRequest({
    path: "/v1/w3s/user/transactions/transfer",
    method: "POST",
    userToken,
    body: requestBody,
  });
  return {
    challengeId: data?.challengeId || null,
    transactionId:
      data?.id ||
      data?.transactionId ||
      data?.transaction?.id ||
      null,
    raw: data,
    requestBody,
  };
}

export function parseTokenAmount(amount, decimals = 6) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("amount must be a positive number");
  }
  return ethers.parseUnits(String(amount), Number(decimals)).toString();
}

