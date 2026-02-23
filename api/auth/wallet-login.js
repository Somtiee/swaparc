import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { walletAddress } = req.body;

  if (!walletAddress) {
      return res.status(400).json({ error: 'Missing walletAddress' });
  }

  try {
    // 1. Check if we have a userId for this wallet
    const walletKey = `wallet:${walletAddress.toLowerCase()}`;
    let userId = await kv.get(walletKey);

    if (userId) {
        // Profile exists, fetch it
        const profile = await kv.hgetall(`profile:${userId}`);
        
        if (profile && Object.keys(profile).length > 0) {
            // Parse badges if string
            if (profile.badges && typeof profile.badges === 'string') {
                try { profile.badges = JSON.parse(profile.badges); } catch (e) {}
            }

            return res.status(200).json({
                success: true,
                isNew: false,
                userId,
                profile
            });
        }
    }

    // 1b. Check for legacy profile (keyed by wallet address)
    const legacyProfile = await kv.get(`profile:${walletAddress}`);
    if (legacyProfile) {
        // Found legacy profile, migrate/use it
        // We will use the wallet address as userId for consistency with old data, 
        // but set up the mapping for future lookups
        userId = walletAddress;
        
        // Ensure mapping exists
        await kv.set(walletKey, userId);

        return res.status(200).json({
            success: true,
            isNew: false,
            userId,
            profile: legacyProfile
        });
    }

    // 2. Create new profile
    // Use wallet address (lowercase) as userId to keep it simple and clean
    userId = walletAddress.toLowerCase();
    
    const newProfile = {
        username: `User ${walletAddress.slice(0, 6)}`,
        walletAddress: walletAddress,
        avatar: "",
        swapVolume: 0,
        swapCount: 0,
        lpProvided: 0,
        badges: { firstSwap: false, volume1000: false },
        createdAt: new Date().toISOString()
    };

    // Save profile and mapping
    await kv.hset(`profile:${userId}`, {
        ...newProfile,
        badges: JSON.stringify(newProfile.badges)
    });
    await kv.set(walletKey, userId);

    return res.status(200).json({
        success: true,
        isNew: true,
        userId,
        profile: newProfile
    });

  } catch (error) {
    console.error("Wallet login error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
