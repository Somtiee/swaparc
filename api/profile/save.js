import { kv } from "@vercel/kv";

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
    const existingProfile = await kv.hgetall(profileKey) || {};

    if (existingProfile.badges && typeof existingProfile.badges === 'string') {
        try { existingProfile.badges = JSON.parse(existingProfile.badges); } catch (e) {}
    }

    // Determine final stats (ALWAYS use existing DB values for stats to prevent client overwrites)
    const finalSwapCount = Number(existingProfile.swapCount || 0);
    const finalSwapVolume = Number(existingProfile.swapVolume || 0);
    const finalLpProvided = Number(existingProfile.lpProvided || 0);

    // Check badge unlock
    const isEarlySwaparcer = finalSwapCount >= 100 || finalSwapVolume >= 10000 || finalLpProvided >= 1000;
    
    const updatedBadges = {
        ...(existingProfile.badges || {}),
        earlySwaparcer: isEarlySwaparcer || (existingProfile.badges && existingProfile.badges.earlySwaparcer)
    };

    const profile = {
      ...existingProfile,
      // Update fields if provided, otherwise keep existing or default
      username: username || existingProfile.username,
      walletId: walletId || existingProfile.walletId,
      avatar: avatar || existingProfile.avatar || "",
      walletAddress: walletAddress || existingProfile.walletAddress || "",
      
      // Ensure numeric/stats fields exist
      swapVolume: finalSwapVolume,
      swapCount: finalSwapCount,
      lpProvided: finalLpProvided,
      badges: updatedBadges
    };

    await kv.hset(profileKey, {
        ...profile,
        badges: JSON.stringify(updatedBadges)
    });

    // Update leaderboards
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
