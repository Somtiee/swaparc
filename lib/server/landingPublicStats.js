/**
 * Weekly landing stats bundle: written by cron, read from CDN static JSON (no Railway Redis on page load).
 */

import { kv } from "./kv.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LANDING_STATS_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const LANDING_STATS_CDN_S_MAXAGE_SEC = 7 * 24 * 60 * 60;
export const LANDING_STATS_CDN_STALE_SEC = 24 * 60 * 60;

const HIGHWATER_KEY = "stats:landing:highwater:v1";
const COUNT_SWAPPERS_KEY = "stats:countUniqueSwappers:last";
const TOTAL_SWAP_VOLUME_KEY = "stats:totalSwapVolume:last";
const TOP_LIMIT = 10;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_STATS_PATH = join(ROOT, "public/stats/landing-network.json");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStats(stats) {
  const src = stats && typeof stats === "object" ? stats : {};
  return {
    totalSwapVolume: Math.max(0, toNumber(src.totalSwapVolume)),
    totalSwapCount: Math.max(0, toNumber(src.totalSwapCount)),
    uniqueUsers: Math.max(0, toNumber(src.uniqueUsers)),
  };
}

async function topRowsFromZset(zkey, scoreField) {
  const ranked = await kv.zrevrange(zkey, 0, TOP_LIMIT - 1, { withScores: true });
  if (!ranked.length) return [];

  const profiles = await kv.mget(...ranked.map((r) => `profile:${r.member}`));
  return ranked.map((row, index) => {
    const p = profiles[index] || {};
    let badges = p.badges || {};
    if (typeof badges === "string") {
      try {
        badges = JSON.parse(badges);
      } catch {
        badges = {};
      }
    }
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

export async function buildLeaderboardSnapshot() {
  const [topSwapVolume, topSwapCount, topLPProvided, countStats, volStats] =
    await Promise.all([
      topRowsFromZset("leaderboard:swapVolume", "swapVolume"),
      topRowsFromZset("leaderboard:swapCount", "swapCount"),
      topRowsFromZset("leaderboard:lpProvided", "lpProvided"),
      kv.get(COUNT_SWAPPERS_KEY),
      kv.get(TOTAL_SWAP_VOLUME_KEY),
    ]);

  return {
    topSwapVolume,
    topSwapCount,
    topLPProvided,
    totalSwapVolume: Number(volStats?.totalSwapVolume) || 0,
    totalSwapCount:
      Number(countStats?.totalSwapCount ?? countStats?.totalSwapCalls) || 0,
    totalLP: 0,
    uniqueUsers:
      Number(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets) || 0,
    egressSafe: true,
    scanFree: true,
  };
}

/**
 * @param {{ totalSwapVolume: number, totalSwapCount: number, uniqueSwapWallets: number }} scanned
 */
export async function buildLandingPublicPayload(scanned) {
  const highwaterState = await kv.get(HIGHWATER_KEY);
  const previousStats = normalizeStats(highwaterState?.latest || highwaterState);

  const observed = normalizeStats({
    totalSwapVolume: scanned.totalSwapVolume,
    totalSwapCount: scanned.totalSwapCount,
    uniqueUsers: scanned.uniqueSwapWallets,
  });

  const mergedStats = normalizeStats({
    totalSwapVolume: Math.max(observed.totalSwapVolume, previousStats.totalSwapVolume),
    totalSwapCount: Math.max(observed.totalSwapCount, previousStats.totalSwapCount),
    uniqueUsers: Math.max(observed.uniqueUsers, previousStats.uniqueUsers),
  });

  await kv.set(HIGHWATER_KEY, {
    latest: mergedStats,
    previous: previousStats,
    observed: mergedStats,
    updatedAt: Date.now(),
  });

  const leaderboard = await buildLeaderboardSnapshot();
  const refreshedAt = new Date().toISOString();

  return {
    ok: true,
    refreshedAt,
    stats: mergedStats,
    leaderboard: {
      ...leaderboard,
      totalSwapVolume: Math.max(mergedStats.totalSwapVolume, leaderboard.totalSwapVolume),
      totalSwapCount: Math.max(mergedStats.totalSwapCount, leaderboard.totalSwapCount),
      uniqueUsers: Math.max(mergedStats.uniqueUsers, leaderboard.uniqueUsers),
    },
    source: "weekly-cron-static",
  };
}

export async function writeLandingPublicJsonFile(payload) {
  await mkdir(dirname(PUBLIC_STATS_PATH), { recursive: true });
  await writeFile(PUBLIC_STATS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Persist JSON for CDN / Blob (optional). */
export async function publishLandingPublicStats(payload) {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  const result = { blobConfigured: Boolean(token), blobUrl: null, blobError: null };

  if (token) {
    try {
      const { put } = await import("@vercel/blob");
      const putResult = await put("landing-network.json", JSON.stringify(payload), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
      });
      result.blobUrl = putResult?.url || null;
      if (!result.blobUrl) {
        result.blobError = "Blob put succeeded but returned no URL";
      }
    } catch (err) {
      result.blobError = err?.message || String(err);
      console.warn("[landing-public-stats] Blob upload failed:", result.blobError);
    }
  } else {
    result.blobError = "BLOB_READ_WRITE_TOKEN not set on this deployment";
  }

  try {
    await writeLandingPublicJsonFile(payload);
  } catch (err) {
    console.warn("[landing-public-stats] public/stats write failed:", err?.message || err);
  }

  return result;
}
