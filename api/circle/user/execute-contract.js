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
    } = req.body || {};

    // ---- FORENSIC LOG: Incoming payload ----
    console.log("[CircleTx] FORENSIC INCOMING:", {
      walletIdPresent: !!walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters: JSON.stringify(abiParameters),
      isNestedArray: Array.isArray(abiParameters) && abiParameters.some(Array.isArray),
      receivedKeys,
    });

    // Validate required fields (abiParameters can be an empty array for no-arg functions)
    if (!userToken || !walletId || !contractAddress || !abiFunctionSignature || !Array.isArray(abiParameters)) {
      console.error("[CircleTx] Validation failed:", {
        hasUserToken: !!userToken,
        hasWalletId: !!walletId,
        hasContractAddress: !!contractAddress,
        hasAbiFunctionSignature: !!abiFunctionSignature,
        abiParametersIsArray: Array.isArray(abiParameters),
      });
      return res.status(400).json({
        error: "Missing required parameters",
        code: 400,
        details: "userToken, walletId, contractAddress, abiFunctionSignature, abiParameters (array) are required",
        payloadKeys: receivedKeys,
      });
    }

    const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();

    // ---- Build the exact body that Circle's User-Controlled contractExecution expects ----
    // Per Circle docs: feeLevel is a TOP-LEVEL string: "LOW" | "MEDIUM" | "HIGH"
    // DO NOT nest it inside a fee object — that is for developer-controlled wallets.
    const body = {
      idempotencyKey: requestId,
      walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      feeLevel: "MEDIUM",
    };

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

    console.log("[CircleTx] Challenge created:", executeJson.data?.challengeId);
    return res.status(200).json({ challengeId: executeJson.data?.challengeId });
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
