import { kv } from "@vercel/kv";

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
    const profile = await kv.hgetall(profileKey) || {};

    // Parse badges if string (legacy or hash storage)
    if (profile.badges && typeof profile.badges === 'string') {
      try {
        profile.badges = JSON.parse(profile.badges);
      } catch (e) {
        profile.badges = {};
      }
    }

    const currentSwapCount = Number(profile.swapCount || 0);
    const currentSwapVolume = Number(profile.swapVolume || 0);
    
    // Update LP provided value
    const newLpProvided = Number(lpTotalValue);

    // Unlock conditions: swapCount >= 100 OR swapVolume >= 10000 OR lpProvided >= 1000
    const isEarlySwaparcer = currentSwapCount >= 100 || currentSwapVolume >= 10000 || newLpProvided >= 1000;

    const updatedBadges = {
        ...(profile.badges || {}),
        earlySwaparcer: isEarlySwaparcer
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

    // Update leaderboard
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
