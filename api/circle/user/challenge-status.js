export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { challengeId } = req.query;
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
      try {
        const txRes = await fetch(`${baseUrl}/v1/w3s/user/transactions/${id}`, {
          method: "GET",
          headers: authHeaders,
        });
        const txJson = await txRes.json().catch(() => ({}));
        if (txRes.ok) {
          const txData = txJson?.data?.transaction || txJson?.data || {};
          console.log(`[challenge-status] TX lookup for ${id}:`, JSON.stringify(txData, null, 2));
          return txData;
        }
      } catch (e) { /* best-effort */ }
      return null;
    };

    // Try transactionId first
    if (!transactionHash && txId) {
      const txData = await fetchTx(txId);
      if (txData) {
        transactionHash = txData?.txHash || txData?.transactionHash || txData?.onChain?.txHash || null;
        txState = txData?.state || txData?.status || null;
        txErrorReason = txData?.errorReason || txData?.errorDetails || txData?.onChain?.errorReason || null;
      }
    }

    // If still no hash, try correlationId (this is the real transaction ID from Circle)
    if (!transactionHash && correlationId) {
      const txData = await fetchTx(correlationId);
      if (txData) {
        transactionHash = txData?.txHash || txData?.transactionHash || txData?.onChain?.txHash || null;
        txState = txData?.state || txData?.status || null;
        txErrorReason = txData?.errorReason || txData?.errorDetails || txData?.onChain?.errorReason || null;
      }
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
