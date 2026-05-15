import { kv } from "../../lib/server/kv.js";

const LEADERBOARD_CACHE_KEY = "stats:leaderboard:response:v1";
const LEADERBOARD_CACHE_TTL_MS = 60 * 60 * 1000;
const COUNT_SWAPPERS_KEY = "stats:countUniqueSwappers:last";
const TOTAL_SWAP_VOLUME_KEY = "stats:totalSwapVolume:last";

const TOP_LIMIT = 10;

async function topRowsFromZset(zkey, scoreField) {
  const ranked = await kv.zrevrange(zkey, 0, TOP_LIMIT - 1, { withScores: true });
  if (!ranked.length) return [];

  const profiles = await kv.mget(...ranked.map((r) => `profile:${r.member}`));
  return ranked.map((row, index) => {
    const p = profiles[index] || {};
    const badges =
      typeof p.badges === "string"
        ? (() => {
            try {
              return JSON.parse(p.badges);
            } catch {
              return {};
            }
          })()
        : p.badges || {};
    return {
      userId: row.member,
      username: p.username || "Anon",
      avatar: p.avatar || "",
      [scoreField]: row.score,
      swapVolume: Number(p.swapVolume ?? row.score) || 0,
      swapCount: Number(p.swapCount) || 0,
      lpProvided: Number(p.lpProvided) || 0,
      badges,
    };
  });
}

async function readAggregateTotals() {
  const [countStats, volStats] = await Promise.all([
    kv.get(COUNT_SWAPPERS_KEY),
    kv.get(TOTAL_SWAP_VOLUME_KEY),
  ]);
  return {
    totalSwapVolume: Number(volStats?.totalSwapVolume) || 0,
    totalSwapCount: Number(countStats?.totalSwapCount ?? countStats?.totalSwapCalls) || 0,
    uniqueUsers:
      Number(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets) || 0,
    totalLP: 0,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const now = Date.now();
    const cached = await kv.get(LEADERBOARD_CACHE_KEY);
    if (
      cached &&
      typeof cached === "object" &&
      Number(cached.cachedAt || 0) > 0 &&
      now - Number(cached.cachedAt) < LEADERBOARD_CACHE_TTL_MS
    ) {
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=300");
      return res.status(200).json({
        ...cached.payload,
        egressSafe: true,
        cached: true,
      });
    }

    const [topSwapVolume, topSwapCount, topLPProvided, totals] = await Promise.all([
      topRowsFromZset("leaderboard:swapVolume", "swapVolume"),
      topRowsFromZset("leaderboard:swapCount", "swapCount"),
      topRowsFromZset("leaderboard:lpProvided", "lpProvided"),
      readAggregateTotals(),
    ]);

    const payload = {
      topSwapVolume,
      topSwapCount,
      topLPProvided,
      totalSwapVolume: totals.totalSwapVolume,
      totalSwapCount: totals.totalSwapCount,
      totalLP: totals.totalLP,
      uniqueUsers: totals.uniqueUsers,
      egressSafe: true,
      scanFree: true,
    };

    await kv.set(LEADERBOARD_CACHE_KEY, { cachedAt: now, payload });

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
