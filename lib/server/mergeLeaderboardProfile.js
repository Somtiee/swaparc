/**
 * Merge username + wallet profile hashes for leaderboard / Dune export.
 * Matches api/profile/get.js wallet lookup behavior.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

export function mergeProfileStats(primary, secondary) {
  const a = normalizeProfile(primary);
  const b = normalizeProfile(secondary);
  return {
    ...a,
    ...b,
    username: b.username || a.username || "Anon",
    avatar: b.avatar || a.avatar || "",
    walletAddress: b.walletAddress || a.walletAddress || "",
    swapCount: Math.max(toNumber(a.swapCount), toNumber(b.swapCount)),
    swapVolume: Math.max(toNumber(a.swapVolume), toNumber(b.swapVolume)),
    lpProvided: Math.max(toNumber(a.lpProvided), toNumber(b.lpProvided)),
    badges: b.badges ?? a.badges,
  };
}

export function leaderboardWalletId(member, mergedProfile) {
  const wallet = String(mergedProfile?.walletAddress || "").toLowerCase();
  if (wallet.startsWith("0x")) return wallet;
  const id = String(member || "");
  return id.startsWith("0x") ? id.toLowerCase() : id;
}

/** Scan wallet:* keys once — maps username userId → 0x wallet. */
export async function buildUserIdToWalletMap(kv) {
  const map = new Map();
  let cursor = 0;
  let guard = 0;
  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, { match: "wallet:*", count: 500 });
    cursor = Number(nextCursor) || 0;
    guard += 1;
    if (Array.isArray(keys) && keys.length) {
      for (const key of keys) {
        const wallet = key.replace(/^wallet:/, "").toLowerCase();
        const userId = await kv.get(key);
        if (userId && wallet.startsWith("0x")) {
          map.set(String(userId).trim(), wallet);
        }
      }
    }
    if (cursor === 0 || guard > 100_000) break;
  }
  return map;
}

/**
 * @param {Map<string, string>|null} userIdToWallet optional reverse map from buildUserIdToWalletMap
 */
export async function resolveMergedLeaderboardProfile(kv, member, primary, userIdToWallet = null) {
  const id = String(member || "").trim();
  let merged = normalizeProfile(primary);

  if (id.startsWith("0x")) {
    const lower = id.toLowerCase();
    const mapped = await kv.get(`wallet:${lower}`);
    if (mapped) {
      const mappedProfile = await kv.hgetall(`profile:${mapped}`);
      merged = mergeProfileStats(mappedProfile, merged);
      merged.userId = mapped;
      merged.walletAddress = lower;
    } else {
      merged.walletAddress = lower;
    }
    return merged;
  }

  let wallet = String(merged.walletAddress || "").toLowerCase();
  if (!wallet.startsWith("0x") && userIdToWallet?.has(id)) {
    wallet = userIdToWallet.get(id);
  }
  if (wallet.startsWith("0x")) {
    const walletProfile = await kv.hgetall(`profile:${wallet}`);
    merged = mergeProfileStats(merged, walletProfile);
    merged.walletAddress = wallet;
  }

  return merged;
}
