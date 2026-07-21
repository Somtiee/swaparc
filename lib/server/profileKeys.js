/**
 * Canonical profile key resolution — wallet addresses map to username userIds.
 * Keep addSwap, get, and the live indexer writing/reading the same key.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {import("./kv.js").kv} kv
 * @param {string} userIdOrWallet
 */
export async function resolveCanonicalProfile(kv, userIdOrWallet) {
  const id = String(userIdOrWallet || "").trim();
  if (!id) {
    return {
      profileKey: null,
      memberId: null,
      wallet: null,
      mappedId: null,
    };
  }

  if (id.startsWith("0x")) {
    const wallet = id.toLowerCase();
    const mappedId = await kv.get(`wallet:${wallet}`);
    const memberId = mappedId ? String(mappedId).trim() : wallet;
    return {
      profileKey: `profile:${memberId}`,
      memberId,
      wallet,
      mappedId: mappedId ? String(mappedId).trim() : null,
    };
  }

  return {
    profileKey: `profile:${id}`,
    memberId: id,
    wallet: null,
    mappedId: id,
  };
}

/**
 * Merge wallet + mapped profile hashes the same way as api/profile/get.js.
 * @param {import("./kv.js").kv} kv
 * @param {{ profileKey: string, memberId: string, wallet: string|null, mappedId: string|null }} resolved
 */
export async function readMergedSwapStats(kv, resolved) {
  if (!resolved?.profileKey) {
    return { swapCount: null, swapVolume: null, lpProvided: null };
  }

  const primary = (await kv.hgetall(resolved.profileKey).catch(() => null)) || {};
  let secondary = null;
  if (resolved.wallet && resolved.mappedId) {
    secondary =
      (await kv.hgetall(`profile:${resolved.wallet}`).catch(() => null)) || {};
  }

  const swapCount = Math.max(
    toNumber(primary.swapCount),
    toNumber(secondary?.swapCount)
  );
  const swapVolume = Math.max(
    toNumber(primary.swapVolume),
    toNumber(secondary?.swapVolume)
  );
  const lpProvided = Math.max(
    toNumber(primary.lpProvided),
    toNumber(secondary?.lpProvided)
  );

  return { swapCount, swapVolume, lpProvided, primary, secondary };
}

/**
 * Lift wallet-key leftovers onto the canonical mapped profile so Math.max
 * display and future hincrby stay aligned.
 * @param {import("./kv.js").kv} kv
 * @param {{ profileKey: string, memberId: string, wallet: string|null, mappedId: string|null }} resolved
 */
export async function healCanonicalSwapStats(kv, resolved) {
  if (!resolved?.mappedId || !resolved?.wallet || !resolved?.profileKey) {
    return null;
  }

  const merged = await readMergedSwapStats(kv, resolved);
  const primaryCount = toNumber(merged.primary?.swapCount);
  const primaryVolume = toNumber(merged.primary?.swapVolume);
  const primaryLp = toNumber(merged.primary?.lpProvided);

  const needsHeal =
    primaryCount < merged.swapCount ||
    primaryVolume < merged.swapVolume ||
    primaryLp < merged.lpProvided;

  if (!needsHeal) {
    return {
      swapCount: merged.swapCount,
      swapVolume: merged.swapVolume,
      lpProvided: merged.lpProvided,
      healed: false,
    };
  }

  await kv.hset(resolved.profileKey, {
    swapCount: merged.swapCount,
    swapVolume: merged.swapVolume,
    lpProvided: merged.lpProvided,
  });

  // Prevent the stale wallet hash from winning Math.max after a later mapped write.
  await kv
    .hset(`profile:${resolved.wallet}`, {
      swapCount: 0,
      swapVolume: 0,
      lpProvided: 0,
    })
    .catch(() => {});

  await kv
    .zadd("leaderboard:swapCount", {
      score: merged.swapCount,
      member: resolved.memberId,
    })
    .catch(() => {});
  await kv
    .zadd("leaderboard:swapVolume", {
      score: merged.swapVolume,
      member: resolved.memberId,
    })
    .catch(() => {});

  return {
    swapCount: merged.swapCount,
    swapVolume: merged.swapVolume,
    lpProvided: merged.lpProvided,
    healed: true,
  };
}
