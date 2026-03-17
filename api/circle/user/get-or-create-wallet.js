import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const { email, userToken } = req.body || {};

    if (!email || !userToken) {
      return res
        .status(400)
        .json({ error: "email and userToken are required" });
    }

    const key = `circle_user_${email}`;
    let existing = null;

    try {
      existing = await kv.get(key);
    } catch (kvError) {
      console.warn("KV get failed, proceeding without cache:", kvError.message);
    }

    if (
      existing &&
      typeof existing === "object" &&
      existing.walletId &&
      existing.address &&
      existing.blockchain
    ) {
      return res.status(200).json({
        walletId: existing.walletId,
        address: existing.address,
        blockchain: existing.blockchain,
      });
    }

    // Call Circle API directly instead of self-referential fetch to avoid port issues
    const circleBaseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";
    console.log(`[get-or-create-wallet] Fetching wallets from Circle API directly`);
    
    const walletsRes = await fetch(`${circleBaseUrl}/v1/w3s/wallets`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-User-Token": userToken,
      },
    });

    const walletsJson = await walletsRes.json().catch(() => ({}));

    if (!walletsRes.ok) {
      const msg =
        walletsJson?.error ||
        walletsJson?.message ||
        "Failed to fetch Circle wallets";
      console.error("[get-or-create-wallet] Wallet fetch failed:", msg);
      return res.status(walletsRes.status).json({ error: msg });
    }

    const data = walletsJson?.data || walletsJson || {};
    const wallets = data.wallets || [];
    
    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(404).json({ error: "No Circle wallets found" });
    }

    const first = wallets[0];
    const wallet = {
      walletId: first.walletId || first.id,
      address: first.address,
      blockchain: first.blockchain,
    };

    try {
      await kv.set(key, wallet);
    } catch (kvError) {
      console.warn("KV set failed:", kvError.message);
    }

    return res.status(200).json(wallet);
  } catch (err) {
    console.error("[get-or-create-wallet] Internal Error:", err);
    return res.status(500).json({ 
      error: "Internal server error", 
      details: err.message 
    });
  }
}

