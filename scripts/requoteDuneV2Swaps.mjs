/**
 * Re-price V2 swap rows using pool get_dy (USDC-equivalent at execution).
 * Fixes SWPRC / CircBTC / cross-pair swaps that were $0 with USDC/EURC-only logic.
 *
 * Usage: npm run stats:requote-dune-v2
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  V2_SWAP_POOL_ADDRESS,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
} from "../lib/swapPoolStatsConfig.js";
import {
  createPoolUsdcQuoter,
  usdVolumeUsdcEquivalent,
  asyncPool,
} from "../lib/server/onChainSwapVolume.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = join(ROOT, "data/dune-export/grant/swaparc_new_swap_pool.csv");
const CONCURRENCY = Math.max(1, Number(process.env.VOLUME_QUOTE_CONCURRENCY || 4));

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  const raw = await readFile(CSV_PATH, "utf8");
  const lines = raw.trim().split("\n");
  if (lines.length < 2) throw new Error(`Missing rows in ${CSV_PATH}`);

  const header = parseCsvLine(lines[0]);
  const volIdx = header.indexOf("usd_volume");
  const blockIdx = header.indexOf("block_number");
  const iIdx = header.indexOf("token_in_index");
  const jIdx = header.indexOf("token_out_index");
  const inSymIdx = header.indexOf("token_in_symbol");
  const outSymIdx = header.indexOf("token_out_symbol");
  const amtInIdx = header.indexOf("amount_in");
  const amtOutIdx = header.indexOf("amount_out");

  const quoter = createPoolUsdcQuoter(V2_SWAP_POOL_ADDRESS, { concurrency: CONCURRENCY });
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  console.log(`Re-quoting ${rows.length.toLocaleString()} V2 swaps (get_dy → USDC)…`);

  let zeroBefore = 0;
  let zeroAfter = 0;
  let sumBefore = 0;
  let sumAfter = 0;

  const priced = await asyncPool(CONCURRENCY, rows, async (cols) => {
    const oldVol = Number(cols[volIdx]) || 0;
    sumBefore += oldVol;
    if (oldVol === 0) zeroBefore += 1;

    const i = Number(cols[iIdx]);
    const j = Number(cols[jIdx]);
    const inSym = cols[inSymIdx] || SWAP_POOL_INDEX_TO_SYMBOL[i];
    const outSym = cols[outSymIdx] || SWAP_POOL_INDEX_TO_SYMBOL[j];
    const blockTag = Number(cols[blockIdx]);
    const dx = ethers.parseUnits(
      cols[amtInIdx],
      SWAP_POOL_TOKEN_DECIMALS[inSym] || 6
    );
    const dy = ethers.parseUnits(
      cols[amtOutIdx],
      SWAP_POOL_TOKEN_DECIMALS[outSym] || 6
    );

    const vol = await usdVolumeUsdcEquivalent(i, j, dx, dy, quoter.quoteToUsdc, blockTag);
    cols[volIdx] = String(vol);
    sumAfter += vol;
    if (vol === 0) zeroAfter += 1;
    return cols;
  });

  const out = [header.map(csvEscape).join(","), ...priced.map((c) => c.map(csvEscape).join(","))].join(
    "\n"
  );
  await writeFile(CSV_PATH, `${out}\n`, "utf8");

  console.log("\n========================================");
  console.log(`Volume before: $${sumBefore.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Volume after:  $${sumAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Zero-volume rows: ${zeroBefore} → ${zeroAfter}`);
  console.log(`get_dy calls: ${quoter.quoteCalls}, failures: ${quoter.quoteFailures}`);
  console.log("Next: npm run stats:refresh-dune-grant-summaries");
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
