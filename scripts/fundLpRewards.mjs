/**
 * Fund + configure LP rewards on per-pair SwaparcPoolV2 pools (owner ops).
 *
 * What it does, per pool:
 *   1. fundRewards(amount)          — pulls `amount` of the pool's FIRST token
 *                                     (e.g. USDC in USDC/EURC) from the owner
 *                                     wallet into the pool's reward reserve.
 *   2. setRewardRatePerSecond(rate) — reward accrual per LP token per second
 *                                     (raw units; contract default 1e14).
 *
 * DRY-RUN BY DEFAULT. Add --apply (or REWARDS_APPLY=1) to actually send.
 *
 * Env:
 *   MY_PK                  — pool owner / treasury key
 *   ARC_RPC_URL            — RPC (defaults to the network config)
 *   REWARDS_POOL_ID        — single pool id (e.g. usdc-eurc) or "all" (default all)
 *   REWARDS_AMOUNT         — human units of the pool's first token, e.g. 500
 *                            (skip funding if unset)
 *   REWARDS_RATE           — raw rewardRatePerSecond to set
 *                            (skip rate change if unset)
 *
 * Usage:
 *   npm run rewards:fund -- --dry-run          (default preview)
 *   npm run rewards:fund -- --apply            (broadcast)
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ARC_PUBLIC_RPC } from "../lib/arcNetwork.js";
import { LP_POOLS, ARC_TOKEN_ADDRESSES } from "../lib/lpPoolsConfig.js";

const RPC = process.env.ARC_RPC_URL || ARC_PUBLIC_RPC;
const PRIVATE_KEY = String(process.env.MY_PK || "").trim();
const APPLY =
  process.env.REWARDS_APPLY === "1" || process.argv.includes("--apply");

const POOL_FILTER = String(process.env.REWARDS_POOL_ID || "all").trim();
const AMOUNT_HUMAN = String(process.env.REWARDS_AMOUNT || "").trim();
const RATE_RAW = String(process.env.REWARDS_RATE || "").trim();

if (!PRIVATE_KEY) throw new Error("Missing MY_PK in .env (must be the pool owner)");
if (!AMOUNT_HUMAN && !RATE_RAW) {
  throw new Error("Nothing to do: set REWARDS_AMOUNT (human units) and/or REWARDS_RATE (raw per-second)");
}

const POOL_ABI = [
  "function tokens(uint256) view returns (address)",
  "function owner() view returns (address)",
  "function rewardReserve() view returns (uint256)",
  "function rewardRatePerSecond() view returns (uint256)",
  "function fundRewards(uint256 amount)",
  "function setRewardRatePerSecond(uint256 rate)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const targets = LP_POOLS.filter(
  (p) => POOL_FILTER === "all" || p.id === POOL_FILTER
);
if (!targets.length) {
  throw new Error(
    `No pools match REWARDS_POOL_ID="${POOL_FILTER}". Known: ${LP_POOLS.map((p) => p.id).join(", ")}`
  );
}

console.log(`Network RPC: ${RPC}`);
console.log(`Owner:       ${wallet.address}`);
console.log(`Mode:        ${APPLY ? "APPLY (broadcasting)" : "DRY-RUN (preview — add --apply to send)"}`);
console.log(`Targets:     ${targets.map((p) => p.id).join(", ")}\n`);

for (const pool of targets) {
  const contract = new ethers.Contract(pool.poolAddress, POOL_ABI, wallet);
  const owner = await contract.owner();
  const token0 = await contract.tokens(0);
  const token0Contract = new ethers.Contract(token0, ERC20_ABI, wallet);
  const [symbol, decimals, reserve, currentRate] = await Promise.all([
    token0Contract.symbol(),
    token0Contract.decimals(),
    contract.rewardReserve(),
    contract.rewardRatePerSecond(),
  ]);

  console.log(`— ${pool.name} (${pool.id})`);
  console.log(`  pool:      ${pool.poolAddress}`);
  console.log(`  reward token: ${symbol} (${token0})`);
  console.log(`  rewardReserve: ${ethers.formatUnits(reserve, decimals)} ${symbol}`);
  console.log(`  rewardRatePerSecond: ${currentRate} (raw)`);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.log(
      `  ⚠ owner is ${owner}, not your key — SKIPPING this pool (fund from the owner wallet)`
    );
    continue;
  }

  if (AMOUNT_HUMAN) {
    const amount = ethers.parseUnits(AMOUNT_HUMAN, decimals);
    console.log(`  fundRewards: ${AMOUNT_HUMAN} ${symbol} (raw ${amount})`);
    if (APPLY) {
      const allowance = await token0Contract.allowance(wallet.address, pool.poolAddress);
      if (allowance < amount) {
        console.log(`  approving ${symbol}...`);
        const ap = await token0Contract.approve(pool.poolAddress, amount);
        await ap.wait();
        console.log(`  approved`);
      }
      const tx = await contract.fundRewards(amount);
      console.log(`  fundRewards tx: ${tx.hash} — waiting...`);
      await tx.wait();
      console.log(`  ✓ funded`);
    }
  }

  if (RATE_RAW) {
    const rate = BigInt(RATE_RAW);
    if (rate === currentRate) {
      console.log(`  rate unchanged (${rate}) — skipping set`);
    } else {
      console.log(`  setRewardRatePerSecond: ${currentRate} → ${rate}`);
      if (APPLY) {
        const tx = await contract.setRewardRatePerSecond(rate);
        console.log(`  setRate tx: ${tx.hash} — waiting...`);
        await tx.wait();
        console.log(`  ✓ rate set`);
      }
    }
  }
  console.log("");
}

if (!APPLY) {
  console.log("Dry-run complete. Re-run with --apply (and the same env) to broadcast.");
} else {
  console.log("Done. Rewards are live on the pools above.");
}
