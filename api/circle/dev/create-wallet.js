// DEV-Controlled wallet (treasury/ARCPAY). Not used for user login.
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { isProductionEnv } from "../security/walletAuth.js";

const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
const DEV_WALLET_SECRET = process.env.CIRCLE_DEV_WALLET_SECRET || "";
let circleClient = null;

function getClient() {
  if (!circleClient) {
    circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: API_KEY,
      entitySecret: ENTITY_SECRET,
    });
  }
  return circleClient;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (isProductionEnv() && !DEV_WALLET_SECRET) {
    return res.status(404).json({ error: "Not found" });
  }
  if (DEV_WALLET_SECRET) {
    const provided = String(req.headers["x-dev-wallet-secret"] || "");
    if (provided !== DEV_WALLET_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }
    if (!API_KEY || !ENTITY_SECRET) {
      return res.status(500).json({ error: "Missing Circle credentials" });
    }

    const client = getClient();
    const name = `swaparc-${Buffer.from(String(email)).toString("hex").slice(0, 16)}`;

    const walletSetResp = await client.createWalletSet({ name });
    const walletSetId = walletSetResp?.data?.walletSet?.id || "";
    if (!walletSetId) {
      return res.status(500).json({ error: "WalletSet creation failed" });
    }

    let walletsResp;
    try {
      walletsResp = await client.createWallets({
        walletSetId,
        accountType: "SCA",
        blockchains: ["MATIC-AMOY"],
        count: 1,
        metadata: [{ name: `wallet-${email}` }],
      });
    } catch (e) {
      walletsResp = await client.createWallets({
        walletSetId,
        accountType: "EOA",
        blockchains: ["MATIC-AMOY"],
        count: 1,
        metadata: [{ name: `wallet-${email}` }],
      });
    }

    const wallet = walletsResp?.data?.wallets?.[0];
    if (!wallet?.id) {
      return res.status(500).json({ error: "Wallet creation failed" });
    }

    return res.status(200).json({
      walletSetId,
      walletId: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Create wallet failed" });
  }
}

