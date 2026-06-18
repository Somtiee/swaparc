import { kv } from "../../lib/server/kv.js";
import { isFrozenEarlySwaparcer } from "../../lib/server/earlySwaparcerFrozen.js";
import { assertOwnerAuth, assertIpRateLimit } from "../security/walletAuth.js";

function sanitizeBadges(raw) {
  if (!raw) return {};
  let obj = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === true || v === "true") out[k] = true;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { walletAddress } = req.body;

  if (!walletAddress) {
      return res.status(400).json({ error: 'Missing walletAddress' });
  }

  try {
    await assertIpRateLimit(req, "auth-wallet-login", 20);
    await assertOwnerAuth(req, walletAddress, "auth-wallet-login");
    // 1. Check if we have a userId for this wallet
    const walletKey = `wallet:${walletAddress.toLowerCase()}`;
    let userId = await kv.get(walletKey);

    if (userId) {
        // Profile exists, fetch it
        const profile = await kv.hgetall(`profile:${userId}`);
        
        if (profile && Object.keys(profile).length > 0) {
            const badges = sanitizeBadges(profile.badges);
            const addrCandidate = String(profile.walletAddress || walletAddress || "").toLowerCase();
            const inFrozenSnapshot = addrCandidate
              ? await isFrozenEarlySwaparcer(addrCandidate)
              : false;
            if (inFrozenSnapshot) badges.earlySwaparcer = true;
            else delete badges.earlySwaparcer;
            profile.badges = badges;

            // Persist cleanup so stale true flags are removed permanently.
            await kv.hset(`profile:${userId}`, {
              badges: JSON.stringify(badges),
            }).catch(() => {});

            return res.status(200).json({
                success: true,
                isNew: false,
                userId,
                profile
            });
        }
    }

    // 1b. Check for legacy profile (keyed by wallet address)
    const legacyRaw = await kv.get(`profile:${walletAddress}`);
    const legacyProfile =
      legacyRaw && typeof legacyRaw === "object" ? legacyRaw : null;
    if (legacyProfile) {
        // Found legacy profile, migrate/use it
        // We will use the wallet address as userId for consistency with old data, 
        // but set up the mapping for future lookups
        userId = walletAddress;
        
        // Ensure mapping exists
        await kv.set(walletKey, userId);

        const legacyBadges = sanitizeBadges(legacyProfile.badges);
        const legacyAddr = String(legacyProfile.walletAddress || walletAddress || "").toLowerCase();
        const inFrozenSnapshot = legacyAddr
          ? await isFrozenEarlySwaparcer(legacyAddr)
          : false;
        if (inFrozenSnapshot) legacyBadges.earlySwaparcer = true;
        else delete legacyBadges.earlySwaparcer;
        const normalizedLegacyProfile = {
          ...legacyProfile,
          badges: legacyBadges,
        };

        await kv.hset(`profile:${userId}`, {
            badges: JSON.stringify(legacyBadges),
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            isNew: false,
            userId,
            profile: normalizedLegacyProfile
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
        badges: {},
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
