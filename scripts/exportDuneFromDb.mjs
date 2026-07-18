/**
 * Export Dune-ready CSVs from Redis (run locally once — no app/Railway egress).
 *
 * Uses the same sources as the landing page:
 *   stats:landing:highwater:v1, stats:countUniqueSwappers:last,
 *   stats:totalSwapVolume:last, leaderboard zsets.
 *
 * Usage: npm run stats:export-dune-db
 * Output: data/dune-export/db/*.csv (small files, under Dune 200MB limit)
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { createClient } from "../lib/server/kv.js";
import {
  resolveMergedLeaderboardProfile,
  leaderboardWalletId,
  buildUserIdToWalletMap,
} from "../lib/server/mergeLeaderboardProfile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.DUNE_EXPORT_OUT_DIR || join(ROOT, "data/dune-export/db");

const HIGHWATER_KEY = "stats:landing:highwater:v1";
const COUNT_KEY = "stats:countUniqueSwappers:last";
const VOLUME_KEY = "stats:totalSwapVolume:last";
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.DUNE_DB_SCAN_COUNT || 1000));
const TOP_LIMIT = Math.min(500, Math.max(10, Number(process.env.DUNE_DB_TOP_LIMIT || 100)));
const RUN_PROFILE_SCAN = String(process.env.DUNE_DB_PROFILE_SCAN || "false").toLowerCase() === "true";

const kv = createClient();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

async function writeCsv(filename, header, rows) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, filename);
  const stream = createWriteStream(path, { encoding: "utf8" });
  stream.write(csvLine(header));
  for (const cols of rows) stream.write(csvLine(cols));
  stream.end();
  await finished(stream);
  return { path, rows: rows.length };
}

function avatarForCsv(avatar) {
  const s = String(avatar || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return "";
}

function badgesForCsv(badges) {
  let b = badges || {};
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      return "";
    }
  }
  if (!b || typeof b !== "object") return "";
  return Object.keys(b)
    .filter((k) => b[k])
    .join("|");
}

function pickLandingTotals(highwater, countStats, volStats, profileScan) {
  const hw = highwater?.latest || highwater || {};
  const fromProfile = profileScan || {};

  return {
    total_swap_count: Math.max(
      toNumber(hw.totalSwapCount),
      toNumber(countStats?.totalSwapCount ?? countStats?.totalSwapCalls),
      toNumber(fromProfile.totalSwapCount)
    ),
    total_swap_volume_usd: Math.max(
      toNumber(hw.totalSwapVolume),
      toNumber(volStats?.totalSwapVolume ?? volStats?.totalSwapVolumeUsd),
      toNumber(fromProfile.totalSwapVolume)
    ),
    unique_users: Math.max(
      toNumber(hw.uniqueUsers),
      toNumber(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets),
      toNumber(fromProfile.uniqueSwapWallets)
    ),
    source_highwater: Boolean(hw.totalSwapCount || hw.totalSwapVolume || hw.uniqueUsers),
    scanned_profiles: toNumber(fromProfile.scannedProfiles),
  };
}

async function scanProfileTotals() {
  let cursor = 0;
  let iterations = 0;
  let scannedProfiles = 0;
  let totalSwapVolume = 0;
  let totalSwapCount = 0;
  let uniqueSwapWallets = 0;

  console.log("  Scanning profile:* (one-time local read, not app egress)…");

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
        const lp = toNumber(profile.lpProvided || 0);
        totalSwapCount += swapCount;
        totalSwapVolume += swapVolume;
        if (swapCount > 0 || swapVolume > 0 || lp > 0) uniqueSwapWallets += 1;
      }
    }

    if (iterations % 50 === 0) {
      process.stdout.write(`\r  profiles scanned: ${scannedProfiles}, swapCount sum: ${totalSwapCount.toLocaleString()}`);
    }

    if (cursor === 0 || cursor === "0") break;
    if (iterations > 1_000_000) throw new Error("Profile scan guard tripped");
  }

  process.stdout.write("\n");
  return { scannedProfiles, totalSwapVolume, totalSwapCount, uniqueSwapWallets };
}

async function topLeaderboardRows(zkey, scoreField, userIdToWallet) {
  const ranked = await kv.zrevrange(zkey, 0, TOP_LIMIT - 1, { withScores: true });
  if (!ranked.length) return [];

  const profiles = await kv.mget(...ranked.map((r) => `profile:${r.member}`));
  const rows = [];
  for (let index = 0; index < ranked.length; index += 1) {
    const row = ranked[index];
    const p = await resolveMergedLeaderboardProfile(
      kv,
      row.member,
      profiles[index],
      userIdToWallet
    );
    rows.push([
      index + 1,
      leaderboardWalletId(row.member, p),
      p.username || "Anon",
      avatarForCsv(p.avatar),
      Number(p.swapVolume ?? (scoreField === "swapVolume" ? row.score : 0)) || 0,
      Number(p.swapCount ?? (scoreField === "swapCount" ? row.score : 0)) || 0,
      Number(p.lpProvided ?? (scoreField === "lpProvided" ? row.score : 0)) || 0,
      badgesForCsv(p.badges),
    ]);
  }
  return rows;
}

async function main() {
  console.log("SwapArc → Dune CSV export (Redis / landing stats, local only)");
  console.log(`Output: ${OUT_DIR}`);

  const [highwater, countStats, volStats] = await Promise.all([
    kv.get(HIGHWATER_KEY),
    kv.get(COUNT_KEY),
    kv.get(VOLUME_KEY),
  ]);

  let profileScan = null;
  if (RUN_PROFILE_SCAN) {
    profileScan = await scanProfileTotals();
  }

  const totals = pickLandingTotals(highwater, countStats, volStats, profileScan);
  const refreshedAt = new Date().toISOString();

  console.log("\nLanding-aligned totals:");
  console.log(`  total_swap_count:      ${totals.total_swap_count.toLocaleString()}`);
  console.log(`  total_swap_volume_usd: ${totals.total_swap_volume_usd.toLocaleString()}`);
  console.log(`  unique_users:          ${totals.unique_users.toLocaleString()}`);

  const totalsFile = await writeCsv(
    "swaparc_network_totals.csv",
    [
      "refreshed_at",
      "total_swap_count",
      "total_swap_volume_usd",
      "unique_users",
      "source",
      "scanned_profiles",
    ],
    [
      [
        refreshedAt,
        totals.total_swap_count,
        totals.total_swap_volume_usd,
        totals.unique_users,
        totals.source_highwater ? "landing_highwater_redis" : "redis_stats_keys",
        totals.scanned_profiles || "",
      ],
    ]
  );

  console.log("\n  Building wallet ↔ username map for merged leaderboards…");
  const userIdToWallet = await buildUserIdToWalletMap(kv);

  const [topVolume, topCount, topLp] = await Promise.all([
    topLeaderboardRows("leaderboard:swapVolume", "swapVolume", userIdToWallet),
    topLeaderboardRows("leaderboard:swapCount", "swapCount", userIdToWallet),
    topLeaderboardRows("leaderboard:lpProvided", "lpProvided", userIdToWallet),
  ]);

  const lbHeader = [
    "rank",
    "wallet",
    "username",
    "avatar",
    "swap_volume",
    "swap_count",
    "lp_provided",
    "badges",
  ];

  const volFile = await writeCsv("swaparc_top_swap_volume.csv", lbHeader, topVolume);
  const countFile = await writeCsv("swaparc_top_swap_count.csv", lbHeader, topCount);
  const lpFile = await writeCsv("swaparc_top_lp.csv", lbHeader, topLp);

  const summary = {
    exportedAt: refreshedAt,
    outDir: OUT_DIR,
    totals,
    files: {
      network_totals: totalsFile,
      top_swap_volume: volFile,
      top_swap_count: countFile,
      top_lp: lpFile,
    },
    duneNote:
      "Upload swaparc_network_totals.csv for headline metrics matching swaparc.app landing. " +
      "Use top_* CSVs for leaderboard charts. PrivPay: use data/dune-export/fixed/swaparc_privpay.csv",
    profileScanRan: RUN_PROFILE_SCAN,
  };

  await writeFile(join(OUT_DIR, "README.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("\n========================================");
  console.log("Done! Files written:");
  console.log(`  ${totalsFile.path} (${totalsFile.rows} row)`);
  console.log(`  ${volFile.path} (${volFile.rows} rows)`);
  console.log(`  ${countFile.path} (${countFile.rows} rows)`);
  console.log(`  ${lpFile.path} (${lpFile.rows} rows)`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("exportDuneFromDb failed:", err);
  process.exit(1);
});
