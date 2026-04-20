import { circleUserRequest } from "../_circleUserApi.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userToken } = req.body || {};
    if (!userToken) {
      return res.status(400).json({ error: "Missing userToken" });
    }

    const data = await circleUserRequest({
      path: "/v1/w3s/wallets",
      method: "GET",
      userToken,
    });

    const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
    const normalized = wallets.map((w) => ({
      id: w.id,
      address: w.address,
      blockchain: w.blockchain,
      state: w.state,
      custodyType: w.custodyType,
      walletSetId: w.walletSetId,
      createDate: w.createDate,
      updateDate: w.updateDate,
    }));

    return res.status(200).json({
      ok: true,
      wallets: normalized,
      defaultWallet: normalized[0] || null,
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      ok: false,
      error: e?.message || "Failed to load Circle wallets",
      details: e?.details || null,
    });
  }
}

