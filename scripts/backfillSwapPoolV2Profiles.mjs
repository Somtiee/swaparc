/**
 * One-time / periodic: backfill V2 swap pool txs into profile:* KV (swapCount + swapVolume).
 * Run on Railway: railway run -s swaparc node scripts/backfillSwapPoolV2Profiles.mjs
 */
import "dotenv/config";
import { ethers } from "ethers";
import { kv } from "../lib/server/kv.js";
import {
  SWAP_INDEXER_V2_STATE_KEY,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
} from "../lib/swapPoolStatsConfig.js";
import { scanSwapPoolTxs } from "../lib/server/scanSwapPoolTxs.js";
import { claimSwapTxForIndexing } from "../lib/server/swapIndexDedup.js";

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const DRY_RUN = process.argv.includes("--dry-run");
const RESET = process.argv.includes("--reset");

const POOL_ABI = ["function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)"];
const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)",
]);
const ARCSCAN_API = "https://testnet.arcscan.app/api";

async function usdForSwap(pool, i, dx) {
  const sym = SWAP_POOL_INDEX_TO_SYMBOL[Number(i)];
  if (sym === "USDC") return Number(ethers.formatUnits(dx, 6));
  try {
    const quote = await pool.get_dy(i, 0, dx);
    return Number(ethers.formatUnits(quote, 6));
  } catch {
    return 0;
  }
}

async function fetchSwapTxsWithVolume(poolAddress, startBlock) {
  let cursor = startBlock;
  const rows = [];

  while (true) {
    const url =
      `${ARCSCAN_API}?module=account&action=txlist` +
      `&address=${poolAddress}` +
      `&startblock=${cursor}&endblock=999999999&sort=asc`;
    const data = await (await fetch(url)).json();
    if (data.status !== "1" || !data.result?.length) break;

    for (const tx of data.result) {
      if (tx.isError === "1" || !tx.input || tx.input === "0x") continue;
      let decoded;
      try {
        decoded = iface.parseTransaction({ data: tx.input });
      } catch {
        continue;
      }
      if (decoded?.name !== "swap") continue;
      rows.push({
        wallet: String(tx.from).toLowerCase(),
        i: Number(decoded.args[0]),
        dx: decoded.args[2],
        block: Number(tx.blockNumber),
        hash: tx.hash,
      });
    }
    cursor = Number(data.result[data.result.length - 1].blockNumber) + 1;
  }
  return rows;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(V2_SWAP_POOL_ADDRESS, POOL_ABI, provider);

  if (RESET && !DRY_RUN) {
    await kv.del(SWAP_INDEXER_V2_STATE_KEY);
    console.log("Cleared", SWAP_INDEXER_V2_STATE_KEY);
  }

  const startBlock = SWAP_POOL_V2_FROM_BLOCK;
  console.log("Backfill V2 profiles from block", startBlock, "pool", V2_SWAP_POOL_ADDRESS);

  const rows = await fetchSwapTxsWithVolume(V2_SWAP_POOL_ADDRESS, startBlock);
  console.log("Found", rows.length, "swap txs");

  const walletDeltas = new Map();
  for (const row of rows) {
    if (row.hash && !(await claimSwapTxForIndexing(row.hash))) continue;

    const usd = await usdForSwap(pool, row.i, row.dx);
    const cur = walletDeltas.get(row.wallet) || { count: 0, volume: 0 };
    cur.count += 1;
    cur.volume += usd;
    walletDeltas.set(row.wallet, cur);
  }

  console.log("Wallets to update:", walletDeltas.size);
  if (DRY_RUN) return;

  for (const [wallet, { count, volume }] of walletDeltas) {
    const profileKey = `profile:${wallet}`;
    const newCount = await kv.hincrby(profileKey, "swapCount", count);
    const newVolume = await kv.hincrbyfloat(profileKey, "swapVolume", volume);
    await kv.zadd("leaderboard:swapVolume", {
      score: Number(newVolume),
      member: wallet,
    });
    console.log(`${wallet}: +${count} swaps, +$${volume.toFixed(2)} → count=${newCount}`);
  }

  const scan = await scanSwapPoolTxs(V2_SWAP_POOL_ADDRESS, { startBlock });
  const lastBlock =
    rows.length > 0 ? Math.max(...rows.map((r) => r.block)) : startBlock;
  await kv.set(SWAP_INDEXER_V2_STATE_KEY, lastBlock + 1);
  console.log("Set", SWAP_INDEXER_V2_STATE_KEY, "to", lastBlock + 1);
  console.log("Done. V2 swap calls on chain:", scan.totalSwapCalls);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
