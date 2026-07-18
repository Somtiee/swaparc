/**
 * Sync headline KPIs + leaderboards from public landing JSON (no Redis).
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DUNE_DB_DIR = join(ROOT, "data/dune-export/db");

export const LANDING_STATS_URL =
  process.env.DUNE_LANDING_STATS_URL ||
  process.env.VITE_LANDING_STATS_URL ||
  "https://swaparc.app/stats/landing-network.json";

const LB_HEADER = [
  "rank",
  "wallet",
  "username",
  "avatar",
  "swap_volume",
  "swap_count",
  "lp_provided",
  "badges",
];

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function badgesForCsv(badges) {
  if (!badges || typeof badges !== "object") return "";
  return Object.keys(badges)
    .filter((k) => badges[k])
    .join("|");
}

function leaderboardRows(entries) {
  return (entries || []).map((e, index) => [
    index + 1,
    e.userId || "",
    e.username || "Anon",
    "",
    Number(e.swapVolume) || 0,
    Number(e.swapCount) || 0,
    Number(e.lpProvided) || 0,
    badgesForCsv(e.badges),
  ]);
}

export async function fetchLandingStats(url = LANDING_STATS_URL) {
  const urls = [url];
  if (!url.includes("localhost") && !url.startsWith("file:")) {
    urls.push(join(ROOT, "public/stats/landing-network.json"));
  }

  let lastErr;
  for (const target of urls) {
    try {
      if (target.endsWith(".json") && !target.startsWith("http")) {
        const raw = await readFile(target, "utf8");
        return JSON.parse(raw);
      }
      const res = await fetch(target, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to fetch landing stats from ${url}${lastErr ? `: ${lastErr.message}` : ""}`
  );
}

export async function syncLandingCsvs(payload, { outDir = DUNE_DB_DIR } = {}) {
  await mkdir(outDir, { recursive: true });

  const stats = payload?.stats || {};
  const refreshedAt = payload?.refreshedAt || new Date().toISOString();
  const leaderboard = payload?.leaderboard || {};

  const totalsCsv = [
    csvLine([
      "refreshed_at",
      "total_swap_count",
      "total_swap_volume_usd",
      "unique_users",
      "source",
      "scanned_profiles",
    ]),
    csvLine([
      refreshedAt,
      Math.max(0, Number(stats.totalSwapCount) || 0),
      Math.max(0, Number(stats.totalSwapVolume) || 0),
      Math.max(0, Number(stats.uniqueUsers) || 0),
      "landing_public_json",
      "",
    ]),
  ].join("");

  const totalsPath = join(outDir, "swaparc_network_totals.csv");
  await writeFile(totalsPath, totalsCsv, "utf8");

  const historyPath = join(outDir, "swaparc_network_totals_history.csv");
  await appendHistoryRow(historyPath, {
    refreshed_at: refreshedAt,
    total_swap_count: Math.max(0, Number(stats.totalSwapCount) || 0),
    total_swap_volume_usd: Math.max(0, Number(stats.totalSwapVolume) || 0),
    unique_users: Math.max(0, Number(stats.uniqueUsers) || 0),
  });

  // Leaderboards need merged wallet+username profiles from Redis (npm run stats:export-dune-db).
  // Public landing JSON can show stale per-user swap counts — do not overwrite top_* CSVs here.

  return {
    refreshedAt,
    stats,
    totalsPath,
    historyPath,
    topFiles: [],
    landingUrl: LANDING_STATS_URL,
  };
}

export async function appendHistoryRow(historyPath, row) {
  const header = "refreshed_at,total_swap_count,total_swap_volume_usd,unique_users\n";
  let existing = "";
  try {
    existing = await readFile(historyPath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.trim() ? existing.trim().split("\n") : [];
  if (!lines.length) lines.push(header.trim());

  const lastLine = lines[lines.length - 1];
  if (lastLine.includes(row.refreshed_at)) {
    return { appended: false, path: historyPath };
  }

  lines.push(
    csvLine([
      row.refreshed_at,
      row.total_swap_count,
      row.total_swap_volume_usd,
      row.unique_users,
    ]).trimEnd()
  );
  await writeFile(historyPath, `${lines.join("\n")}\n`, "utf8");
  return { appended: true, path: historyPath, rows: lines.length - 1 };
}

export async function syncLandingFromUrl() {
  const payload = await fetchLandingStats();
  return syncLandingCsvs(payload);
}
