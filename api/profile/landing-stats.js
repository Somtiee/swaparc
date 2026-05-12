import { kv } from "../../lib/server/kv.js";
import { readFile } from "node:fs/promises";

const RESPONSE_CACHE_KEY = "stats:landing:response:v2";
const RESPONSE_CACHE_TTL_MS = 60 * 1000;
const VOLUME_CACHE_KEY = "stats:landing:profileVolume:v2";
const VOLUME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

async function scanProfileTotals() {
  const empty = { totalSwapVolume: 0, totalSwapCount: 0, uniqueUsers: 0 };
  const result = await withTimeout(
    (async () => {
      let cursor = 0;
      let totalSwapVolume = 0;
      let totalSwapCount = 0;
      let uniqueUsers = 0;
      let iterations = 0;

      do {
        const scanRes = await withTimeout(
          Promise.resolve()
            .then(() => kv.scan(cursor, { match: "profile:*", count: 400 }))
            .catch(() => null),
          KV_TIMEOUT_MS,
          null
        );
        if (!scanRes || !Array.isArray(scanRes)) break;
        const [nextCursor, keys] = scanRes;
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          const values = await withTimeout(
            Promise.resolve()
              .then(() => kv.mget(...keys))
              .catch(() => []),
            KV_TIMEOUT_MS,
            []
          );
          for (const profile of values || []) {
            if (!profile || typeof profile !== "object") continue;
            const volume = Number(profile.swapVolume || 0);
            const count = Number(profile.swapCount || 0);
            if (Number.isFinite(volume)) totalSwapVolume += volume;
            if (Number.isFinite(count)) totalSwapCount += count;
            if (
              (Number.isFinite(count) && count > 0) ||
              (Number.isFinite(volume) && volume > 0)
            ) {
              uniqueUsers += 1;
            }
          }
        }
        iterations += 1;
        if (iterations > 2000) break;
      } while (cursor !== 0 && cursor !== "0");

      return { totalSwapVolume, totalSwapCount, uniqueUsers };
    })().catch(() => empty),
    12_000,
    empty
  );
  return result || empty;
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
      return res.status(200).json(cachedResponse.payload || {});
    }

    const [countSwappersStats, totalSwapVolumeStats, cachedVolume, arcLensSwapCount] =
      await Promise.all([
        getCountSwappersStats(),
        getTotalSwapVolumeStats(),
        safeKvGet(VOLUME_CACHE_KEY),
        fetchArcLensTxCount(),
      ]);

    let fallbackTotals = null;
    const cachedVolumeValue = Number(cachedVolume?.totalSwapVolume || 0);
    const volumeCacheStale =
      !cachedVolume ||
      !Number.isFinite(cachedVolumeValue) ||
      now - Number(cachedVolume?.updatedAt || 0) > VOLUME_CACHE_TTL_MS;

    if (volumeCacheStale) {
      fallbackTotals = await scanProfileTotals();
      await safeKvSet(VOLUME_CACHE_KEY, {
        totalSwapVolume: Number(fallbackTotals.totalSwapVolume || 0),
        updatedAt: now,
      });
    }
    if (!fallbackTotals) {
      fallbackTotals = await scanProfileTotals();
    }

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

    const observedStats = normalizeStats({
      // Primary: our own scripts/indexed state; Secondary: internal profile scan.
      totalSwapVolume: choosePreferredMetric(
        scriptedSwapVolume,
        fallbackTotals.totalSwapVolume,
        cachedVolumeValue
      ),
      // Primary: countUniqueSwappers script; Secondary: ArcLenz cross-check; then profile scan.
      totalSwapCount: choosePreferredMetric(
        scriptedSwapCount,
        arcLensSwapCount,
        fallbackTotals.totalSwapCount
      ),
      // Primary: countUniqueSwappers script; Secondary: profile scan.
      uniqueUsers: choosePreferredMetric(scriptedUniqueUsers, fallbackTotals.uniqueUsers),
    });

    const highwaterState = await safeKvGet(HIGHWATER_KEY);
    const previousStats = normalizeStats(highwaterState?.latest || highwaterState);
    const mergedStats = normalizeStats({
      totalSwapVolume: Math.max(
        observedStats.totalSwapVolume,
        previousStats.totalSwapVolume
      ),
      totalSwapCount: Math.max(
        observedStats.totalSwapCount,
        previousStats.totalSwapCount
      ),
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
      stats: mergedStats,
      previousStats,
      observedStats,
      refreshedAt: new Date(now).toISOString(),
      sources: {
        totalSwapVolume:
          scriptedSwapVolume > 0
            ? "sumProfileSwapVolume_script_primary"
            : volumeCacheStale
              ? "profiles_sum_recomputed_fallback"
              : "profiles_sum_cached_fallback",
        totalSwapCount:
          scriptedSwapCount > 0
            ? "countUniqueSwappers_script_primary"
            : arcLensSwapCount != null
              ? "arclenz_project_txCount_secondary"
              : "profiles_sum_fallback",
        uniqueUsers:
          scriptedUniqueUsers > 0 ? "countUniqueSwappers_script" : "profiles_sum_fallback",
      },
    };

    await safeKvSet(RESPONSE_CACHE_KEY, {
      cachedAt: now,
      payload,
    });

    return res.status(200).json(payload);
  } catch (error) {
    console.error("landing-stats error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
