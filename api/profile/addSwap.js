import { kv } from "../../lib/server/kv.js";
import {
  claimSwapTxForIndexing,
  releaseSwapTxClaim,
} from "../../lib/server/swapIndexDedup.js";
import {
  healCanonicalSwapStats,
  readMergedSwapStats,
  resolveCanonicalProfile,
} from "../../lib/server/profileKeys.js";
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

    const resolved = await resolveCanonicalProfile(kv, userId);
    if (!resolved.profileKey) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    // Lift any wallet-key leftovers onto the mapped profile before incrementing.
    await healCanonicalSwapStats(kv, resolved).catch(() => null);

    if (txHash && !(await claimSwapTxForIndexing(txHash))) {
      // Indexer (or a prior call) already owns this tx — return merged stats for UI.
      const merged = await readMergedSwapStats(kv, resolved);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "already_indexed",
        newCount: merged.swapCount,
        newVolume: merged.swapVolume,
      });
    }
    claimed = Boolean(txHash);

    const newCount = await kv.hincrby(resolved.profileKey, "swapCount", 1);
    const newVolume = await kv.hincrbyfloat(
      resolved.profileKey,
      "swapVolume",
      amount
    );

    await kv.zadd("leaderboard:swapCount", {
      score: newCount,
      member: resolved.memberId,
    });
    await kv.zadd("leaderboard:swapVolume", {
      score: newVolume,
      member: resolved.memberId,
    });

    return res.status(200).json({ success: true, newCount, newVolume });
  } catch (error) {
    if (claimed) await releaseSwapTxClaim(txHash);
    console.error("Error adding swap:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
