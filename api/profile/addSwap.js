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
import { assertIpRateLimit, assertOwnerAuth } from "../security/walletAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, amount, txHash } = req.body;

  if (!userId || amount == null) {
    return res.status(400).json({ error: "Missing userId or amount" });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(userId))) {
    return res.status(400).json({ error: "userId must be a wallet address" });
  }

  // Volume is leaderboard-ranked — reject absurd or negative client numbers.
  const volume = Number(amount);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1e12) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  if (txHash != null && !/^0x([A-Fa-f0-9]{64})$/.test(String(txHash))) {
    return res.status(400).json({ error: "Invalid txHash" });
  }

  let claimed = false;
  try {
    await assertIpRateLimit(req, "profile-add-swap", 60);

    // Only the wallet that swapped may bump its own stats.
    await assertOwnerAuth(req, String(userId), "profile-add-swap");

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
    return res.status(error?.status || 500).json({ error: "Internal Server Error" });
  }
}
