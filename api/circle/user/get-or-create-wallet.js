import { kv } from "@vercel/kv";

function getInternalBaseUrl() {
  if (process.env.INTERNAL_API_BASE_URL) return process.env.INTERNAL_API_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, userToken } = req.body || {};

    if (!email || !userToken) {
      return res
        .status(500)
        .json({ error: "email and userToken are required" });
    }

    const key = `circle_user_${email}`;

    const existing = await kv.get(key);
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

    const baseUrl = getInternalBaseUrl();

    try {
      const initRes = await fetch(`${baseUrl}/api/circle/user/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken }),
      });

      await initRes.json().catch(() => ({}));
    } catch {
    }

    const walletsRes = await fetch(`${baseUrl}/api/circle/user/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userToken }),
    });

    const walletsJson = await walletsRes.json().catch(() => ({}));

    if (!walletsRes.ok) {
      const msg =
        walletsJson?.error ||
        walletsJson?.message ||
        "Failed to fetch Circle wallets";
      return res.status(walletsRes.status).json({ error: msg });
    }

    const wallets = walletsJson?.wallets || [];
    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(404).json({ error: "No Circle wallets found" });
    }

    const first = wallets[0];
    const wallet = {
      walletId: first.walletId || first.id,
      address: first.address,
      blockchain: first.blockchain,
    };

    await kv.set(key, wallet);

    return res.status(200).json(wallet);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

