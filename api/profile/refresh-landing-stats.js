import { kv } from "../../lib/server/kv.js";

const COUNT_SWAPPERS_KEY = "stats:countUniqueSwappers:last";
const TOTAL_SWAP_VOLUME_KEY = "stats:totalSwapVolume:last";
const LANDING_RESPONSE_CACHE_KEY = "stats:landing:response:v2";
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.STATS_REFRESH_SCAN_COUNT || 1000));

function assertCronAuth(req) {
  const cronSecret = String(process.env.CRON_SECRET || "");
  if (!cronSecret) return;
  const authHeader = String(req.headers.authorization || "");
  if (authHeader !== `Bearer ${cronSecret}`) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function scanProfileStats() {
  let cursor = 0;
  let iterations = 0;
  let scannedProfiles = 0;
  let totalSwapVolume = 0;
  let totalSwapCount = 0;
  let uniqueSwapWallets = 0;

  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: SCAN_MATCH,
      count: SCAN_COUNT,
    });
    cursor = nextCursor;
    iterations += 1;

    if (Array.isArray(keys) && keys.length > 0) {
      const profiles = await kv.mget(...keys);
      for (const profile of profiles || []) {
        if (!profile || typeof profile !== "object") continue;
        scannedProfiles += 1;
        const swapCount = toNumber(profile.swapCount || 0);
        const swapVolume = toNumber(profile.swapVolume || 0);
        totalSwapCount += swapCount;
        totalSwapVolume += swapVolume;
        if (swapCount > 0 || swapVolume > 0) uniqueSwapWallets += 1;
      }
    }

    if (cursor === 0 || cursor === "0") break;
    if (iterations > 1_000_000) {
      throw new Error("Scan aborted: exceeded maximum iteration guard.");
    }
  }

  return {
    scannedProfiles,
    totalSwapVolume,
    totalSwapCount,
    uniqueSwapWallets,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    assertCronAuth(req);
    const startedAt = Date.now();
    const scanned = await scanProfileStats();
    const updatedAt = new Date().toISOString();

    const countPayload = {
      totalSwapCalls: scanned.totalSwapCount,
      totalSwapCount: scanned.totalSwapCount,
      uniqueSwapWallets: scanned.uniqueSwapWallets,
      uniqueUsers: scanned.uniqueSwapWallets,
      scannedProfiles: scanned.scannedProfiles,
      scanBatchSize: SCAN_COUNT,
      updatedAt,
      source: "profile-scan-cron",
    };

    const volumePayload = {
      totalSwapVolume: scanned.totalSwapVolume,
      scannedProfiles: scanned.scannedProfiles,
      scanBatchSize: SCAN_COUNT,
      updatedAt,
      source: "profile-scan-cron",
      durationMs: Date.now() - startedAt,
    };

    await kv.set(COUNT_SWAPPERS_KEY, countPayload);
    await kv.set(TOTAL_SWAP_VOLUME_KEY, volumePayload);
    // Force fresh recompute on next /api/profile/landing-stats call.
    await kv.set(LANDING_RESPONSE_CACHE_KEY, { cachedAt: 0, payload: null });

    return res.status(200).json({
      ok: true,
      updatedAt,
      summary: {
        totalSwapVolume: scanned.totalSwapVolume,
        totalSwapCount: scanned.totalSwapCount,
        uniqueSwapWallets: scanned.uniqueSwapWallets,
        scannedProfiles: scanned.scannedProfiles,
      },
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
