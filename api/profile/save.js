import { kv } from "../../lib/server/kv.js";
import { isFrozenEarlySwaparcer } from "../../lib/server/earlySwaparcerFrozen.js";

function parseBadges(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, username, walletId, avatar, walletAddress, swapCount, swapVolume, lpProvided } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const normalizedId = userId.startsWith("0x") ? userId.toLowerCase() : userId;
    const profileKey = `profile:${normalizedId}`;
    const existingProfile = (await kv.hgetall(profileKey)) || {};

    const existingBadges = parseBadges(existingProfile.badges);

    const finalSwapCount = Number(existingProfile.swapCount || 0);
    const finalSwapVolume = Number(existingProfile.swapVolume || 0);
    const finalLpProvided = Number(existingProfile.lpProvided || 0);

    // Early Swaparcer claiming is FROZEN. We never auto-grant new badges here;
    // we only preserve an existing flag, or honor a wallet captured in the
    // pre-freeze snapshot (so qualifiers who never re-saved still keep it).
    const alreadyHasBadge = existingBadges.earlySwaparcer === true || existingBadges.earlySwaparcer === "true";
    const candidateAddress = String(walletAddress || normalizedId || "").toLowerCase();
    const inFrozenSnapshot = candidateAddress
      ? await isFrozenEarlySwaparcer(candidateAddress)
      : false;
    const earlySwaparcerFlag = alreadyHasBadge || inFrozenSnapshot;

    const updatedBadges = {
        ...existingBadges,
        earlySwaparcer: earlySwaparcerFlag,
    };

    const profile = {
      ...existingProfile,
      username: username || existingProfile.username,
      walletId: walletId || existingProfile.walletId,
      avatar: avatar || existingProfile.avatar || "",
      walletAddress: walletAddress || existingProfile.walletAddress || "",

      swapVolume: finalSwapVolume,
      swapCount: finalSwapCount,
      lpProvided: finalLpProvided,
      badges: updatedBadges
    };

    await kv.hset(profileKey, {
        ...profile,
        badges: JSON.stringify(updatedBadges)
    });

    if (finalSwapVolume > 0) {
      await kv.zadd("leaderboard:swapVolume", { score: finalSwapVolume, member: normalizedId });
    }
    if (finalSwapCount > 0) {
      await kv.zadd("leaderboard:swapCount", { score: finalSwapCount, member: normalizedId });
    }
    if (finalLpProvided > 0) {
      await kv.zadd("leaderboard:lpProvided", { score: finalLpProvided, member: normalizedId });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Save failed" });
  }
}
