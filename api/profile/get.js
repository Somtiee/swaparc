import { kv } from "../../lib/server/kv.js";
import { isFrozenEarlySwaparcer } from "../../lib/server/earlySwaparcerFrozen.js";
import { healCanonicalSwapStats } from "../../lib/server/profileKeys.js";
// import { startIndexer } from "../indexers/swapIndexer.js";

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

// if (!globalThis.__swapIndexerStarted) {
//   globalThis.__swapIndexerStarted = true;
//   // startIndexer();
// }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = req.query;

    let key = `profile:${userId}`;
    let profile = null;

    if (userId && userId.startsWith("0x")) {
      const lower = userId.toLowerCase();
      const mapped = await kv.get(`wallet:${lower}`);
      const walletKey = `profile:${lower}`;
      const mappedKey = mapped ? `profile:${mapped}` : null;

      const [walletProfile, mappedProfile] = await Promise.all([
        kv.hgetall(walletKey),
        mappedKey ? kv.hgetall(mappedKey) : Promise.resolve(null),
      ]);

      if (mappedProfile && walletProfile) {
        key = mappedKey;
        // One-time heal: volume-only backfills / indexer wrote wallet keys while
        // addSwap wrote mapped userIds — Math.max hid count stalls.
        const healed = await healCanonicalSwapStats(kv, {
          profileKey: mappedKey,
          memberId: mapped,
          wallet: lower,
          mappedId: mapped,
        }).catch(() => null);
        profile = {
          ...mappedProfile,
          ...walletProfile,
          userId: mapped,
          walletAddress: lower,
          username: walletProfile.username || mappedProfile.username,
          avatar: walletProfile.avatar || mappedProfile.avatar,
          swapCount:
            healed?.swapCount ??
            Math.max(
              Number(walletProfile.swapCount) || 0,
              Number(mappedProfile.swapCount) || 0
            ),
          swapVolume:
            healed?.swapVolume ??
            Math.max(
              Number(walletProfile.swapVolume) || 0,
              Number(mappedProfile.swapVolume) || 0
            ),
          lpProvided:
            healed?.lpProvided ??
            Math.max(
              Number(walletProfile.lpProvided) || 0,
              Number(mappedProfile.lpProvided) || 0
            ),
        };
      } else if (mappedProfile) {
        key = mappedKey;
        profile = { ...mappedProfile, walletAddress: lower, userId: mapped };
      } else {
        key = walletKey;
        profile = walletProfile;
      }
    } else {
      profile = await kv.hgetall(key);
    }

    if (profile) {
      const badges = sanitizeBadges(profile.badges);
      const normalizedUser = String(userId || "").toLowerCase();
      const addrCandidate = String(
        profile.walletAddress || (normalizedUser.startsWith("0x") ? normalizedUser : "")
      ).toLowerCase();
      const inFrozenSnapshot = addrCandidate
        ? await isFrozenEarlySwaparcer(addrCandidate)
        : false;
      if (inFrozenSnapshot) badges.earlySwaparcer = true;
      else delete badges.earlySwaparcer;
      profile.badges = badges;

      // Persist cleanup so stale true flags are removed permanently.
      await kv.hset(key, { badges: JSON.stringify(badges) }).catch(() => {});
    }

    if (!profile) {
      return res.status(200).json({
        success: false,
        message: "Profile not found"
      });
    }

    return res.status(200).json({
      success: true,
      profile
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: "Internal Server Error" });
  }
}
