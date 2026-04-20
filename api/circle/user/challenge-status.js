const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function extractTxHashFromObject(obj, depth = 0, maxDepth = 6) {
  if (obj == null || depth > maxDepth) return null;
  if (typeof obj === "string" && TX_HASH_RE.test(obj)) return obj;
  if (typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractTxHashFromObject(item, depth + 1, maxDepth);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(obj)) {
    const found = extractTxHashFromObject(v, depth + 1, maxDepth);
    if (found) return found;
  }
  return null;
}

function pickTxHashFromTransactionRecord(txData) {
  if (!txData || typeof txData !== "object") return null;
  const direct =
    txData.txHash ||
    txData.transactionHash ||
    txData.hash ||
    txData?.onChain?.txHash ||
    txData?.onChain?.transactionHash ||
    txData?.blockchainEvent?.transactionHash ||
    txData?.blockchainEvent?.txHash ||
    txData?.result?.transactionHash ||
    null;
  if (direct && typeof direct === "string" && TX_HASH_RE.test(direct)) return direct;
  return extractTxHashFromObject(txData);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { challengeId, transactionId: transactionIdHint } = req.query;
  const userToken = req.headers["x-user-token"];
  const apiKey = process.env.CIRCLE_API_KEY;
  const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";

  if (!challengeId) return res.status(400).json({ error: "Missing challengeId" });
  if (!userToken) return res.status(401).json({ error: "Missing X-User-Token header" });
  if (!apiKey) return res.status(500).json({ error: "Server misconfiguration: Missing API Key" });

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-User-Token": userToken,
  };
  const apiOnlyHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const response = await fetch(`${baseUrl}/v1/w3s/user/challenges/${challengeId}`, {
      method: "GET",
      headers: authHeaders,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("[challenge-status] Circle API Error:", data);
      return res.status(response.status).json({ error: data.message || "Failed to fetch challenge status" });
    }

    const rawData = data?.data || {};
    const challenge = rawData?.challenge || rawData;

    console.log(`[challenge-status] Raw Circle response data:`, JSON.stringify(rawData, null, 2));

    const state = challenge?.status || challenge?.state || rawData?.status || rawData?.state || "";

    // === Try to resolve the actual transaction using correlationIds ===
    // Circle challenge.correlationIds[0] is the transaction's ID in their system.
    const correlationId = challenge?.correlationIds?.[0] || null;

    let transactionHash = null;
    let txState = null;
    let txErrorReason = null;

    // First try known fields on challenge itself
    transactionHash =
      challenge?.transactionHash ||
      challenge?.txHash ||
      challenge?.transaction?.transactionHash ||
      challenge?.transaction?.txHash ||
      null;

    // Try transactionId field
    const txId = challenge?.transactionId || challenge?.transaction?.id || null;

    // Helper to fetch a transaction by ID from Circle
    const fetchTx = async (id) => {
      const targetId = String(id || "").trim();
      if (!targetId) return null;
      const attempts = [
        {
          url: `${baseUrl}/v1/w3s/user/transactions/${targetId}`,
          headers: authHeaders,
          label: "user",
        },
        {
          url: `${baseUrl}/v1/w3s/transactions/${targetId}`,
          headers: authHeaders,
          label: "global+userHeader",
        },
        {
          url: `${baseUrl}/v1/w3s/transactions/${targetId}`,
          headers: apiOnlyHeaders,
          label: "global",
        },
      ];
      for (const attempt of attempts) {
        try {
          const txRes = await fetch(attempt.url, {
            method: "GET",
            headers: attempt.headers,
          });
          const txJson = await txRes.json().catch(() => ({}));
          if (txRes.ok) {
            const txData =
              txJson?.data?.transaction ||
              txJson?.data?.transactions?.[0] ||
              txJson?.data ||
              {};
            console.log(
              `[challenge-status] TX lookup (${attempt.label}) for ${targetId}:`,
              JSON.stringify(txData, null, 2)
            );
            return txData;
          }
          console.warn(
            `[challenge-status] TX lookup (${attempt.label}) miss for ${targetId}: status=${txRes.status} body=${JSON.stringify(txJson)}`
          );
        } catch (e) {
          console.warn(
            `[challenge-status] TX lookup (${attempt.label}) error for ${targetId}: ${e?.message || e}`
          );
        }
      }
      return null;
    };

    const applyTxData = (txData) => {
      if (!txData) return;
      const h = pickTxHashFromTransactionRecord(txData);
      if (h) transactionHash = h;
      if (!txState) txState = txData?.state || txData?.status || null;
      if (!txErrorReason) {
        txErrorReason =
          txData?.errorReason ||
          txData?.errorDetails ||
          txData?.onChain?.errorReason ||
          null;
      }
    };

    // Client hint from contractExecution create response (often available before challenge indexes hash)
    if (transactionIdHint && String(transactionIdHint).trim()) {
      const txData = await fetchTx(String(transactionIdHint).trim());
      applyTxData(txData);
    }

    // Try transactionId first
    if (!transactionHash && txId) {
      const txData = await fetchTx(txId);
      applyTxData(txData);
    }

    // correlationIds — Circle may return multiple; try each
    const corrList = Array.isArray(challenge?.correlationIds) ? challenge.correlationIds : [];
    if (!transactionHash && corrList.length) {
      for (const cid of corrList) {
        if (!cid) continue;
        const txData = await fetchTx(cid);
        applyTxData(txData);
        if (transactionHash) break;
      }
    }

    // Legacy single correlationId variable (first element already tried in loop; keep for odd shapes)
    if (!transactionHash && correlationId && !corrList.includes(correlationId)) {
      const txData = await fetchTx(correlationId);
      applyTxData(txData);
    }

    if (!transactionHash && challenge && typeof challenge === "object") {
      const fromChallenge = pickTxHashFromTransactionRecord(challenge);
      if (fromChallenge) transactionHash = fromChallenge;
    }

    console.log(`[challenge-status] Final: state="${state}" txHash=${transactionHash || "none"} txState=${txState} txError=${txErrorReason || "none"}`);

    return res.status(200).json({
      challenge,
      state,
      transactionHash: transactionHash || null,
      txState,
      txErrorReason,
    });
  } catch (error) {
    console.error("[challenge-status] Internal Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
