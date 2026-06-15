/**
 * Scan legacy + V2 swap pools; merge counts and unique wallets (additive, no reset).
 * Writes stats:countUniqueSwappers:last for weekly landing publish.
 *
 * Legacy pool is frozen (no new txs); V2 grows. Union of wallets avoids double-counting
 * the same address across pools.
 */
import "dotenv/config";
import { createClient } from "../lib/server/kv.js";
import { mkdir, writeFile } from "node:fs/promises";
import {
  SWAP_POOLS_FOR_STATS,
  SWAP_POOL_V2_FROM_BLOCK,
} from "../lib/swapPoolStatsConfig.js";
import {
  mergeSwapPoolScanResults,
  scanSwapPoolTxs,
} from "../lib/server/scanSwapPoolTxs.js";

const INCLUDE_FAILED =
  String(process.env.COUNT_SWAPPERS_INCLUDE_FAILED || "false").toLowerCase() ===
  "true";
const SCRIPT_STATS_FILE_URL = new URL(
  "../data/stats/countUniqueSwappers.latest.json",
  import.meta.url
);

const kv = createClient();

async function main() {
  const parts = [];

  for (const pool of SWAP_POOLS_FOR_STATS) {
    const startBlock = pool.id === "v2" ? SWAP_POOL_V2_FROM_BLOCK : 0;
    console.log(`Scanning ${pool.id} pool ${pool.address} from block ${startBlock}...`);
    const result = await scanSwapPoolTxs(pool.address, {
      startBlock,
      includeFailed: INCLUDE_FAILED,
    });
    console.log(
      `  ${pool.id}: swapCalls=${result.totalSwapCalls}, unique=${result.uniqueWallets.size}`
    );
    parts.push(result);
  }

  const merged = mergeSwapPoolScanResults(parts);

  console.log("========================================");
  console.log("Merged total swap() calls:", merged.totalSwapCalls);
  console.log("Merged unique wallets:", merged.uniqueSwapWallets);
  console.log("========================================");

  const payload = {
    ...merged,
    totalSwapCalls: merged.totalSwapCalls,
    pools: SWAP_POOLS_FOR_STATS.map((p) => ({
      id: p.id,
      address: p.address,
      active: p.active,
    })),
    updatedAt: new Date().toISOString(),
    includeFailed: INCLUDE_FAILED,
    source: "dual-pool-arcscan-scan",
  };

  try {
    await mkdir(new URL("../data/stats/", import.meta.url), { recursive: true });
    await writeFile(SCRIPT_STATS_FILE_URL, JSON.stringify(payload, null, 2), "utf8");
    console.log("Saved local stats file:", SCRIPT_STATS_FILE_URL.pathname);
  } catch (e) {
    console.error("Failed to write local stats file:", e?.message || e);
  }

  try {
    await kv.set("stats:countUniqueSwappers:last", payload);
    console.log("Saved stats:countUniqueSwappers:last to KV");
  } catch (e) {
    console.error("Failed to persist countUniqueSwappers stats:", e?.message || e);
  }
}

main().catch((err) => {
  console.error("countUniqueSwappers crashed:", err);
  process.exit(1);
});
