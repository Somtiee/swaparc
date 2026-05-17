import { kv } from "../../lib/server/kv.js";
import { readFile } from "node:fs/promises";
import {
  LANDING_STATS_CDN_S_MAXAGE_SEC,
  LANDING_STATS_CDN_STALE_SEC,
  LANDING_STATS_PERIOD_MS,
} from "../../lib/server/landingPublicStats.js";

const RESPONSE_CACHE_KEY = "stats:landing:response:v2";
/** Legacy API fallback; landing page reads /stats/landing-network.json (no Redis on load). */
const RESPONSE_CACHE_TTL_MS = LANDING_STATS_PERIOD_MS;
const CDN_S_MAXAGE_SEC = LANDING_STATS_CDN_S_MAXAGE_SEC;
const CDN_STALE_SEC = LANDING_STATS_CDN_STALE_SEC;
const HIGHWATER_KEY = "stats:landing:highwater:v1";
const COUNT_SWAPPERS_KEY = "stats:countUniqueSwappers:last";
const TOTAL_SWAP_VOLUME_KEY = "stats:totalSwapVolume:last";
const COUNT_SWAPPERS_FILE_URL = new URL(
  "../../data/stats/countUniqueSwappers.latest.json",
  import.meta.url
);
const TOTAL_SWAP_VOLUME_FILE_URL = new URL(
  "../../data/stats/totalSwapVolume.latest.json",
  import.meta.url
);
const ARCLENZ_SWAPARC_API = "https://arclenz.xyz/api/ecosystem/swaparc";
const KV_TIMEOUT_MS = 1500;
const ARCLENZ_TIMEOUT_MS = 4000;

function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function safeKvGet(key) {
  return withTimeout(
    Promise.resolve()
      .then(() => kv.get(key))
      .catch(() => null),
    KV_TIMEOUT_MS,
    null
  );
}

async function safeKvSet(key, value) {
  return withTimeout(
    Promise.resolve()
      .then(() => kv.set(key, value))
      .then(() => true)
      .catch(() => false),
    KV_TIMEOUT_MS,
    false
  );
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function choosePreferredMetric(...values) {
  let bestFinite = null;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (bestFinite == null || n > bestFinite) bestFinite = n;
    if (n > 0) return n;
  }
  return bestFinite ?? 0;
}

async function readJsonFile(fileUrl) {
  try {
    const raw = await readFile(fileUrl, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function getCountSwappersStats() {
  const kvStats = await safeKvGet(COUNT_SWAPPERS_KEY);
  if (kvStats && typeof kvStats === "object") return kvStats;
  return readJsonFile(COUNT_SWAPPERS_FILE_URL);
}

async function getTotalSwapVolumeStats() {
  const kvStats = await safeKvGet(TOTAL_SWAP_VOLUME_KEY);
  if (kvStats && typeof kvStats === "object") return kvStats;
  return readJsonFile(TOTAL_SWAP_VOLUME_FILE_URL);
}

async function fetchArcLensTxCount() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ARCLENZ_TIMEOUT_MS);
  try {
    const resp = await fetch(ARCLENZ_SWAPARC_API, {
      method: "GET",
      signal: ac.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const txCount = Number(data?.project?.txCount);
    return Number.isFinite(txCount) && txCount > 0 ? txCount : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStats(stats) {
  const src = stats && typeof stats === "object" ? stats : {};
  return {
    totalSwapVolume: Math.max(0, firstFinite(src.totalSwapVolume)),
    totalSwapCount: Math.max(0, firstFinite(src.totalSwapCount)),
    uniqueUsers: Math.max(0, firstFinite(src.uniqueUsers)),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const now = Date.now();
    const cachedResponse = await safeKvGet(RESPONSE_CACHE_KEY);
    if (
      cachedResponse &&
      typeof cachedResponse === "object" &&
      Number(cachedResponse.cachedAt || 0) > 0 &&
      now - Number(cachedResponse.cachedAt || 0) < RESPONSE_CACHE_TTL_MS
    ) {
      res.setHeader(
        "Cache-Control",
        `public, s-maxage=${CDN_S_MAXAGE_SEC}, stale-while-revalidate=${CDN_STALE_SEC}`
      );
      return res.status(200).json(cachedResponse.payload || {});
    }

    const [countSwappersStats, totalSwapVolumeStats, arcLensSwapCount] = await Promise.all([
      getCountSwappersStats(),
      getTotalSwapVolumeStats(),
      fetchArcLensTxCount(),
    ]);

    const scriptedSwapCount = firstFinite(
      countSwappersStats?.totalSwapCalls,
      countSwappersStats?.totalSwapCount,
      countSwappersStats?.swapCount
    );
    const scriptedUniqueUsers = firstFinite(
      countSwappersStats?.uniqueSwapWallets,
      countSwappersStats?.uniqueUsers
    );
    const scriptedSwapVolume = firstFinite(
      totalSwapVolumeStats?.totalSwapVolume,
      totalSwapVolumeStats?.totalSwapVolumeUsd,
      totalSwapVolumeStats?.swapVolume
    );

    const highwaterState = await safeKvGet(HIGHWATER_KEY);
    const previousStats = normalizeStats(highwaterState?.latest || highwaterState);

    const observedStats = normalizeStats({
      totalSwapVolume: Math.max(scriptedSwapVolume, previousStats.totalSwapVolume),
      totalSwapCount: Math.max(
        scriptedSwapCount,
        arcLensSwapCount ?? 0,
        previousStats.totalSwapCount
      ),
      uniqueUsers: Math.max(scriptedUniqueUsers, previousStats.uniqueUsers),
    });

    const mergedStats = normalizeStats({
      totalSwapVolume: Math.max(observedStats.totalSwapVolume, previousStats.totalSwapVolume),
      totalSwapCount: Math.max(observedStats.totalSwapCount, previousStats.totalSwapCount),
      uniqueUsers: Math.max(observedStats.uniqueUsers, previousStats.uniqueUsers),
    });

    await safeKvSet(HIGHWATER_KEY, {
      latest: mergedStats,
      previous: previousStats,
      observed: observedStats,
      updatedAt: now,
    });

    const payload = {
      ok: true,
      egressSafe: true,
      scanFree: true,
      stats: mergedStats,
      previousStats,
      observedStats,
      refreshedAt: new Date(now).toISOString(),
      sources: {
        totalSwapVolume:
          scriptedSwapVolume > 0
            ? "cron_or_script_totalSwapVolume"
            : "highwater_fallback",
        totalSwapCount:
          scriptedSwapCount > 0
            ? "cron_or_script_countUniqueSwappers"
            : arcLensSwapCount != null
              ? "arclenz_project_txCount"
              : "highwater_fallback",
        uniqueUsers:
          scriptedUniqueUsers > 0 ? "cron_or_script_countUniqueSwappers" : "highwater_fallback",
      },
    };

    await safeKvSet(RESPONSE_CACHE_KEY, {
      cachedAt: now,
      payload,
    });

    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CDN_S_MAXAGE_SEC}, stale-while-revalidate=${CDN_STALE_SEC}`
    );
    return res.status(200).json(payload);
  } catch (error) {
    console.error("landing-stats error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
