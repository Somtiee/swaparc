import { kv } from "../../lib/server/kv.js";
import { claimSwapTxForIndexing } from "../../lib/server/swapIndexDedup.js";
import { assertOwnerAuth } from "../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, amount, txHash } = req.body;

  if (!userId || amount == null) {
    return res.status(400).json({ error: "Missing userId or amount" });
  }

  try {
    const walletId = userId.startsWith("0x") ? userId.toLowerCase() : null;
    if (walletId) {
      await assertOwnerAuth(req, walletId, "profile-add-swap");
    }
    if (txHash && !(await claimSwapTxForIndexing(txHash))) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "already_indexed",
      });
    }

    let profileKey = `profile:${userId}`;

    if (userId.startsWith("0x")) {
      const lowerWallet = userId.toLowerCase();
      const mappedId = await kv.get(`wallet:${lowerWallet}`);
      profileKey = mappedId ? `profile:${mappedId}` : `profile:${lowerWallet}`;
    }

    const newCount = await kv.hincrby(profileKey, "swapCount", 1);
    const newVolume = await kv.hincrbyfloat(profileKey, "swapVolume", amount);

    const memberId = profileKey.replace("profile:", "");
    await kv.zadd("leaderboard:swapCount", { score: newCount, member: memberId });
    await kv.zadd("leaderboard:swapVolume", { score: newVolume, member: memberId });

    return res.status(200).json({ success: true, newCount, newVolume });
  } catch (error) {
    console.error("Error adding swap:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
