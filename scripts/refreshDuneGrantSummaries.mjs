/**
 * Refresh grant summary CSVs using public landing JSON + local on-chain CSV sums.
 * No Railway Redis (zero app egress).
 *
 * Usage: npm run stats:refresh-dune-grant-summaries
 */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLandingStats } from "../lib/dune/landingSync.mjs";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  V2_SWAP_POOL_ADDRESS,
} from "../lib/swapPoolStatsConfig.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data/dune-export/grant");

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

async function sumUsdVolumeFromCsvStreaming(filename) {
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const path = join(OUT_DIR, filename);

  let rows = 0;
  let sum = 0;
  let isFirst = true;

  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
  for await (const line of rl) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    if (!line.trim()) continue;
    rows += 1;
    const lastComma = line.lastIndexOf(",");
    if (lastComma >= 0) sum += Number(line.slice(lastComma + 1)) || 0;
  }
  return { sum, rows };
}

async function sumUsdVolumeFromCsv(filename) {
  const path = join(OUT_DIR, filename);
  try {
    const { stat } = await import("node:fs/promises");
    const st = await stat(path);
    if (st.size > 80 * 1024 * 1024) {
      return sumUsdVolumeFromCsvStreaming(filename);
    }
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    if (lines.length < 2) return { sum: 0, rows: 0 };
    let sum = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const lastComma = lines[i].lastIndexOf(",");
      if (lastComma < 0) continue;
      sum += Number(lines[i].slice(lastComma + 1)) || 0;
    }
    return { sum, rows: lines.length - 1 };
  } catch {
    return { sum: 0, rows: 0 };
  }
}

async function countCsvRows(filename) {
  try {
    const text = await readFile(join(OUT_DIR, filename), "utf8");
    return Math.max(0, text.trim().split("\n").length - 1);
  } catch {
    return 0;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const landing = await fetchLandingStats();
  const stats = landing.stats || {};
  const refreshedAt = landing.refreshedAt || new Date().toISOString();

  const platformSwaps = Number(stats.totalSwapCount) || 0;
  const platformVolume = Number(stats.totalSwapVolume) || 0;
  const uniqueUsers = Number(stats.uniqueUsers) || 0;

  const v2 = await sumUsdVolumeFromCsv("swaparc_new_swap_pool.csv");
  const legacy = await sumUsdVolumeFromCsv("swaparc_old_swap_pool.csv");
  const v2Rows = v2.rows || (await countCsvRows("swaparc_new_swap_pool.csv"));
  const legacyOnChainRows = legacy.rows || (await countCsvRows("swaparc_old_swap_pool.csv"));
  const legacySwaps = Math.max(0, platformSwaps - v2Rows);

  const onChainTotal = v2.sum + legacy.sum;
  // V2 pool is fully on-chain; legacy carries the bulk of platform-indexed activity.
  const v2PlatformVol = v2.sum;
  const legacyPlatformVol = Math.max(0, platformVolume - v2PlatformVol);

  const poolTotalHeader = [
    "refreshed_at",
    "segment",
    "pool_id",
    "pool_address",
    "total_swaps",
    "platform_volume_usd",
    "on_chain_volume_usd",
    "unique_wallets",
    "data_source",
    "notes",
  ];

  const poolRows = [
    [
      refreshedAt,
      "OLD SWAP POOL",
      "legacy",
      LEGACY_SWAP_POOL_ADDRESS,
      legacySwaps,
      legacyPlatformVol,
      legacy.sum,
      uniqueUsers,
      "platform_telemetry",
      "Swap count = platform TOTAL − V2 on-chain rows. Platform volume = landing share. On-chain volume = get_dy USDC-equivalent sum from legacy CSV.",
    ],
    [
      refreshedAt,
      "NEW SWAP POOL",
      "v2",
      V2_SWAP_POOL_ADDRESS,
      v2Rows,
      v2PlatformVol,
      v2.sum,
      "",
      "arcscan_on_chain",
      "V2 swaps from chain logs. Volume uses get_dy for all token pairs (USDC/EURC/SWPRC/CircBTC).",
    ],
    [
      refreshedAt,
      "SWAP POOL (TOTAL)",
      "combined",
      `${LEGACY_SWAP_POOL_ADDRESS};${V2_SWAP_POOL_ADDRESS}`,
      platformSwaps,
      platformVolume,
      onChainTotal,
      uniqueUsers,
      "swaparc.app_landing",
      "Platform volume/count match swaparc.app landing. On-chain volume = sum of priced swap legs (subset of platform activity).",
    ],
  ];

  await writeFile(
    join(OUT_DIR, "swaparc_swap_pool_total.csv"),
    poolTotalHeader.map(csvEscape).join(",") + "\n" + poolRows.map((r) => csvLine(r).trim()).join("\n") + "\n",
    "utf8"
  );

  const summaryHeader = [
    "refreshed_at",
    "segment",
    "pool_id",
    "pool_address",
    "platform_swap_count",
    "on_chain_swap_rows",
    "platform_volume_usd",
    "on_chain_usd_volume",
    "unique_wallets",
    "data_source",
    "notes",
  ];

  await writeFile(
    join(OUT_DIR, "swaparc_old_swap_pool_summary.csv"),
    summaryHeader.map(csvEscape).join(",") +
      "\n" +
      csvLine([
        refreshedAt,
        "OLD SWAP POOL",
        "legacy",
        LEGACY_SWAP_POOL_ADDRESS,
        legacySwaps,
        legacyOnChainRows,
        legacyPlatformVol,
        legacy.sum,
        uniqueUsers,
        "platform_telemetry",
        "Matches landing swap count methodology.",
      ]).trim() +
      "\n",
    "utf8"
  );

  // Sync db network totals from landing (for Dune KPI widgets)
  const dbDir = join(ROOT, "data/dune-export/db");
  await mkdir(dbDir, { recursive: true });
  await writeFile(
    join(dbDir, "swaparc_network_totals.csv"),
    csvLine([
      "refreshed_at",
      "total_swap_count",
      "total_swap_volume_usd",
      "unique_users",
      "source",
      "scanned_profiles",
    ]).trim() +
      "\n" +
      csvLine([
        refreshedAt,
        platformSwaps,
        platformVolume,
        uniqueUsers,
        "landing_public_json",
        "",
      ]).trim() +
      "\n",
    "utf8"
  );

  console.log("========================================");
  console.log("GRANT SUMMARIES REFRESHED (no Redis)");
  console.log(`  Landing:  ${platformSwaps.toLocaleString()} swaps | $${platformVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  On-chain: $${onChainTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} (legacy $${legacy.sum.toLocaleString()} + v2 $${v2.sum.toLocaleString()})`);
  console.log(`  V2 zero-volume fix: re-run stats:requote-dune-v2 if needed`);
  console.log("  Next: npm run stats:upload-dune-grant-summaries");
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
