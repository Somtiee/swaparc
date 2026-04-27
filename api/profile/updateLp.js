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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, lpTotalValue } = req.body;

  if (!userId || lpTotalValue == null || isNaN(Number(lpTotalValue))) {
      return res.status(400).json({ error: 'Missing or invalid userId or lpTotalValue' });
  }

  try {
    const profileKey = `profile:${userId}`;
    const profile = (await kv.hgetall(profileKey)) || {};
    profile.badges = parseBadges(profile.badges);

    const newLpProvided = Number(lpTotalValue);

    // Early Swaparcer claiming is FROZEN. Never auto-grant from LP changes;
    // only preserve an existing flag, or restore for snapshotted holders.
    const alreadyHasBadge = profile.badges.earlySwaparcer === true || profile.badges.earlySwaparcer === "true";
    const candidateAddress = String(profile.walletAddress || userId || "").toLowerCase();
    const inFrozenSnapshot = candidateAddress
      ? await isFrozenEarlySwaparcer(candidateAddress)
      : false;
    const earlySwaparcerFlag = alreadyHasBadge || inFrozenSnapshot;

    const updatedBadges = {
        ...profile.badges,
        earlySwaparcer: earlySwaparcerFlag,
    };

    const updatedProfile = {
      ...profile,
      lpProvided: newLpProvided,
      badges: updatedBadges
    };

    await kv.hset(profileKey, {
        ...updatedProfile,
        badges: JSON.stringify(updatedBadges)
    });

    await kv.zadd("leaderboard:lpProvided", {
      score: newLpProvided,
      member: userId
    });

    return res.status(200).json({
      success: true,
      stats: {
          lpProvided: updatedProfile.lpProvided
      }
    });
  } catch (error) {
    console.error("Error updating LP stats:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
