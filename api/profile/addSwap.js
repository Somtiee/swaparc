import { kv } from "../../lib/server/kv.js";
import {
  claimSwapTxForIndexing,
  releaseSwapTxClaim,
} from "../../lib/server/swapIndexDedup.js";
import { assertIpRateLimit } from "../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, amount, txHash } = req.body;

  if (!userId || amount == null) {
    return res.status(400).json({ error: "Missing userId or amount" });
  }

  let claimed = false;
  try {
    await assertIpRateLimit(req, "profile-add-swap", 60);

    let profileKey = `profile:${userId}`;
    if (userId.startsWith("0x")) {
      const lowerWallet = userId.toLowerCase();
      const mappedId = await kv.get(`wallet:${lowerWallet}`);
      profileKey = mappedId ? `profile:${mappedId}` : `profile:${lowerWallet}`;
    }

    if (txHash && !(await claimSwapTxForIndexing(txHash))) {
      // Indexer (or a prior call) already owns this tx — return current stats for UI.
      const existing = await kv.hgetall(profileKey).catch(() => null);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "already_indexed",
        newCount: existing?.swapCount != null ? Number(existing.swapCount) : null,
        newVolume: existing?.swapVolume != null ? Number(existing.swapVolume) : null,
      });
    }
    claimed = Boolean(txHash);

    const newCount = await kv.hincrby(profileKey, "swapCount", 1);
    const newVolume = await kv.hincrbyfloat(profileKey, "swapVolume", amount);

    const memberId = profileKey.replace("profile:", "");
    await kv.zadd("leaderboard:swapCount", { score: newCount, member: memberId });
    await kv.zadd("leaderboard:swapVolume", { score: newVolume, member: memberId });

    return res.status(200).json({ success: true, newCount, newVolume });
  } catch (error) {
    if (claimed) await releaseSwapTxClaim(txHash);
    console.error("Error adding swap:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
