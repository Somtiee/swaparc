import {
  assertNotExpired,
  assertReplayProtected,
  requestDigestHex,
  secureRandomHex,
} from "../../security/hardening.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("[CircleTx] API key missing");
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const receivedKeys = Object.keys(req.body || {});

    const {
      userToken,
      walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      callData,
      requestTimestampMs,
      requestNonce,
    } = req.body || {};

    // ---- FORENSIC LOG: Incoming payload ----
    console.log("[CircleTx] FORENSIC INCOMING:", {
      walletIdPresent: !!walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters: JSON.stringify(abiParameters),
      hasCallData: typeof callData === "string" && callData.startsWith("0x"),
      isNestedArray: Array.isArray(abiParameters) && abiParameters.some(Array.isArray),
      receivedKeys,
    });

    const hasAbi = !!abiFunctionSignature && Array.isArray(abiParameters);
    const hasCallData = typeof callData === "string" && /^0x[0-9a-fA-F]*$/.test(callData);
    if (!userToken || !walletId || !contractAddress || (!hasAbi && !hasCallData) || (hasAbi && hasCallData)) {
      console.error("[CircleTx] Validation failed:", {
        hasUserToken: !!userToken,
        hasWalletId: !!walletId,
        hasContractAddress: !!contractAddress,
        hasAbiFunctionSignature: !!abiFunctionSignature,
        abiParametersIsArray: Array.isArray(abiParameters),
        hasCallData,
      });
      return res.status(400).json({
        error: "Missing required parameters",
        code: 400,
        details:
          "userToken, walletId, contractAddress, and either (abiFunctionSignature + abiParameters[]) or callData are required",
        payloadKeys: receivedKeys,
      });
    }

    const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";
    const requestId =
      String(req.headers["x-request-id"] || "").trim() ||
      secureRandomHex(16).replace(/^0x/, "");

    // Replay + expiration checks to prevent duplicate signed execution requests.
    const nonce = String(requestNonce || secureRandomHex(12));
    const ts = Number(requestTimestampMs || Date.now());
    assertNotExpired({
      requestTimestampMs: ts,
      maxAgeMs: 2 * 60 * 1000,
    });
    const digest = requestDigestHex({
      walletId,
      contractAddress: String(contractAddress).toLowerCase(),
      abiFunctionSignature: hasAbi ? abiFunctionSignature : "callData",
      abiParameters: hasAbi ? abiParameters : [callData],
      nonce,
      ts,
    });
    await assertReplayProtected({
      scope: "circle-contract-execution",
      idempotencyKey: requestId,
      digest,
      ttlSeconds: 10 * 60,
    });

    // ---- Build the exact body that Circle's User-Controlled contractExecution expects ----
    // Per Circle docs: feeLevel is a TOP-LEVEL string: "LOW" | "MEDIUM" | "HIGH"
    // DO NOT nest it inside a fee object — that is for developer-controlled wallets.
    const body = {
      idempotencyKey: requestId,
      walletId,
      contractAddress,
      feeLevel: "MEDIUM",
    };
    if (hasAbi) {
      body.abiFunctionSignature = abiFunctionSignature;
      body.abiParameters = abiParameters;
    } else {
      body.callData = callData;
    }

    // ---- FORENSIC LOG: Outbound body ----
    console.log("[CircleTx] FORENSIC OUTBOUND BODY:", JSON.stringify(body, null, 2));

    const executeRes = await fetch(
      `${baseUrl}/v1/w3s/user/transactions/contractExecution`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-User-Token": userToken,
        },
        body: JSON.stringify(body),
      }
    );

    console.log("[CircleTx] Circle response status:", executeRes.status);
    const executeJson = await executeRes.json().catch(() => ({}));

    if (!executeRes.ok) {
      // ---- FORENSIC LOG: Full Circle error body ----
      console.error("[CircleTx] FORENSIC CIRCLE ERROR BODY:", JSON.stringify(executeJson, null, 2));

      return res.status(executeRes.status).json({
        error: executeJson.message || "Failed to execute contract",
        code: executeJson.code || executeRes.status,
        details: executeJson,
        payloadKeys: receivedKeys,
      });
    }

    const d = executeJson.data || {};
    console.log("[CircleTx] Challenge created:", d.challengeId, "transactionId:", d.id || d.transactionId);
    return res.status(200).json({
      challengeId: d.challengeId,
      transactionId: d.id || d.transactionId || null,
    });
  } catch (err) {
    console.error("[CircleTx] Internal Error:", err);
    return res.status(500).json({
      error: "Internal server error",
      code: 500,
      details: err.message,
      payloadKeys: Object.keys(req.body || {}),
    });
  }
}
