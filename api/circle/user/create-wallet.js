import { secureRandomHex } from "../../security/hardening.js";

/**
 * Create a user-controlled Circle wallet for an authenticated user.
 *
 * Frontend (initializeAndCreateCircleWallet) calls this after user
 * initialization when no wallet exists yet for the requested blockchain.
 * We initiate Circle's CREATE_WALLET user transaction; the SDK then executes
 * the returned challengeId (PIN prompt) to finalize the wallet.
 *
 * POST /api/circle/user/create-wallet
 *   { userToken, blockchain }
 * → { challengeId, transactionId }
 */
const ALLOWED_BLOCKCHAINS = new Set(
  String(process.env.CIRCLE_ALLOWED_BLOCKCHAINS || "ARC-TESTNET")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("[CircleWallet] API key missing");
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const { userToken, blockchain } = req.body || {};
    if (!userToken || typeof userToken !== "string") {
      return res.status(400).json({ error: "Missing userToken" });
    }
    const chain = String(blockchain || "ARC-TESTNET").trim().toUpperCase();
    if (!ALLOWED_BLOCKCHAINS.has(chain)) {
      return res.status(400).json({
        error: `Unsupported blockchain. Allowed: ${[...ALLOWED_BLOCKCHAINS].join(", ")}`,
      });
    }

    const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";
    const requestId =
      String(req.headers["x-request-id"] || "").trim() ||
      secureRandomHex(16).replace(/^0x/, "");

    const createRes = await fetch(`${baseUrl}/v1/w3s/user/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-User-Token": userToken,
      },
      body: JSON.stringify({
        idempotencyKey: requestId,
        transactionType: "CREATE_WALLET",
        blockchains: [chain],
        count: 1,
      }),
    });

    const createJson = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: createJson.message || "Failed to create Circle wallet",
        code: createJson.code || createRes.status,
      });
    }

    const d = createJson.data || {};
    console.log(
      "[CircleWallet] CREATE_WALLET challenge:",
      d.challengeId,
      "transactionId:",
      d.id || d.transactionId
    );
    return res.status(200).json({
      challengeId: d.challengeId || null,
      transactionId: d.id || d.transactionId || null,
    });
  } catch (err) {
    console.error("[CircleWallet] Internal Error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
