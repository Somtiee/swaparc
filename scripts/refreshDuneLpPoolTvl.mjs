/**
 * Refresh LP pool TVL CSV from chain and upload to Dune.
 * Usage: npm run stats:refresh-dune-pool-tvl
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadCsv, requireApiKey } from "../lib/dune/client.mjs";
import { fetchLpPoolTvlSnapshot } from "../lib/server/exportLpPoolTvl.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/dune-export/grant/swaparc_lp_pools.csv");

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

async function main() {
  requireApiKey();
  console.log("Fetching LP pool TVL from chain…");
  const snap = await fetchLpPoolTvlSnapshot();

  const header = [
    "refreshed_at",
    "pool_id",
    "pool_name",
    "pool_address",
    "token_a_symbol",
    "token_a_locked",
    "token_a_usd",
    "token_b_symbol",
    "token_b_locked",
    "token_b_usd",
    "pool_tvl_usd",
  ];

  const lines = [csvLine(header)];
  for (const p of snap.pools) {
    lines.push(
      csvLine([
        p.refreshedAt,
        p.poolId,
        p.poolName,
        p.poolAddress,
        p.tokenASymbol,
        p.tokenALocked,
        p.tokenAUsd,
        p.tokenBSymbol,
        p.tokenBLocked,
        p.tokenBUsd,
        p.poolTvlUsd,
      ])
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, lines.join(""), "utf8");

  console.log(
    `  Total TVL: $${snap.totalTvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} across ${snap.activePools} pools`
  );
  for (const p of snap.pools) {
    console.log(
      `  ${p.poolName}: $${p.poolTvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${p.tokenASymbol} ${p.tokenALocked.toFixed(2)}, ${p.tokenBSymbol} ${p.tokenBLocked.toFixed(2)})`
    );
  }

  console.log("\nUploading swaparc_lp_pools to Dune…");
  const result = await uploadCsv({
    data: lines.join(""),
    tableName: "swaparc_lp_pools",
    description: "LP pool TVL breakdown (USDC/EURC, USDC/SWPRC, EURC/SWPRC) — matches swaparc.app landing.",
  });
  console.log(`  → ${result.full_name}`);
  console.log("\nDone. Run: npm run stats:fix-dune-queries");
}

main().catch((err) => {
  console.error("refreshDuneLpPoolTvl failed:", err.message || err);
  process.exit(1);
});
