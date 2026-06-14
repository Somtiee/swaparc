/**
 * Drain legacy 3-token swap pool into treasury via chunked swap() calls.
 *
 * Legacy pool has no owner withdraw — tokens only leave via swaps.
 *
 * Env:
 *   MY_PK — treasury wallet (0xD4d3…)
 *   ARC_RPC_URL
 *   LEGACY_SWAP_POOL — optional override
 *   DRAIN_MAX_ROUNDS — default 500
 *   DRAIN_DUST_USDC — stop when pool legs below this (default 500)
 *   DRAIN_CHUNK_SWPRC — SWPRC per SWPRC→USDC leg (default 3000)
 *   DRAIN_CHUNK_USDC — USDC per USDC→EURC leg (default 5000)
 *   DRAIN_PAUSE_MS — default 4000
 *
 * Usage:
 *   npm run drain:legacy-pool -- --dry-run
 *   npm run drain:legacy-pool
 */
import "dotenv/config";
import { ethers } from "ethers";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  SWAP_POOL_OWNER_ADDRESS,
} from "../lib/swapPoolConfig.js";

const PRIVATE_KEY = String(process.env.MY_PK || "").trim();
const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const POOL = process.env.LEGACY_SWAP_POOL || LEGACY_SWAP_POOL_ADDRESS;
const MAX_ROUNDS = Number(process.env.DRAIN_MAX_ROUNDS || 500);
const DUST_USDC = Number(process.env.DRAIN_DUST_USDC || 500);
const CHUNK_SWPRC = process.env.DRAIN_CHUNK_SWPRC || "3000";
const CHUNK_USDC = process.env.DRAIN_CHUNK_USDC || "5000";
const PAUSE_MS = Number(process.env.DRAIN_PAUSE_MS || 4000);
const DRY_RUN = process.argv.includes("--dry-run");

const TOKENS = [
  { sym: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6, idx: 0 },
  { sym: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6, idx: 1 },
  { sym: "SWPRC", address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45", decimals: 18, idx: 2 },
];

const POOL_ABI = [
  "function getBalances() view returns (uint256[])",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(raw, dec) {
  return Number(ethers.formatUnits(raw, dec));
}

async function walletBalances(provider, wallet) {
  const out = {};
  for (const t of TOKENS) {
    const c = new ethers.Contract(t.address, ERC20_ABI, provider);
    out[t.sym] = await c.balanceOf(wallet);
  }
  return out;
}

async function printState(label, provider, pool, wallet) {
  const raw = await pool.getBalances();
  const wb = await walletBalances(provider, wallet);
  console.log(`\n${label}`);
  console.log("Pool:");
  TOKENS.forEach((t, i) => console.log(`  ${t.sym}: ${fmt(raw[i], t.decimals)}`));
  console.log("Treasury:");
  TOKENS.forEach((t) => console.log(`  ${t.sym}: ${fmt(wb[t.sym], t.decimals)}`));
  return raw;
}

async function ensureApprove(token, wallet, spender, amount) {
  const c = token.connect(wallet);
  const allowance = await c.allowance(wallet.address, spender);
  if (allowance >= amount) return;
  if (DRY_RUN) {
    console.log(`  [dry-run] approve ${token.target}`);
    return;
  }
  const tx = await c.approve(spender, ethers.MaxUint256);
  await tx.wait();
}

async function trySwap(pool, wallet, tokenIn, i, j, amountIn) {
  const dy = await pool.get_dy(i, j, amountIn);
  if (!dy || dy === 0n) return null;
  console.log(
    `  swap ${TOKENS[i].sym}→${TOKENS[j].sym} in ${fmt(amountIn, TOKENS[i].decimals)} → ~${fmt(dy, TOKENS[j].decimals)}`
  );
  if (DRY_RUN) return { dry: true };
  await ensureApprove(tokenIn, wallet, POOL, amountIn);
  const poolW = pool.connect(wallet);
  const tx = await poolW.swap(i, j, amountIn);
  const receipt = await tx.wait();
  console.log(`  tx ${receipt.hash}`);
  return receipt;
}

async function main() {
  if (!PRIVATE_KEY) throw new Error("Set MY_PK in .env");

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  if (wallet.address.toLowerCase() !== SWAP_POOL_OWNER_ADDRESS.toLowerCase()) {
    throw new Error(`MY_PK is ${wallet.address}, expected treasury ${SWAP_POOL_OWNER_ADDRESS}`);
  }

  const pool = new ethers.Contract(POOL, POOL_ABI, provider);
  const tokenContracts = Object.fromEntries(
    TOKENS.map((t) => [t.sym, new ethers.Contract(t.address, ERC20_ABI, wallet)])
  );

  console.log("Legacy pool drain");
  console.log("Pool:", POOL);
  console.log("Treasury:", wallet.address);
  if (DRY_RUN) console.log("DRY RUN — no transactions");

  let poolRaw = await printState("Initial", provider, pool, wallet.address);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const poolUsdc = fmt(poolRaw[0], 6);
    const poolEurc = fmt(poolRaw[1], 6);
    const poolSwprc = fmt(poolRaw[2], 18);

    if (poolUsdc < DUST_USDC && poolEurc < DUST_USDC && poolSwprc < 1) {
      console.log(`\nPool at dust (USDC ${poolUsdc}, EURC ${poolEurc}, SWPRC ${poolSwprc}). Done.`);
      break;
    }

    console.log(`\n=== Round ${round} ===`);
    let acted = false;
    const wb = await walletBalances(provider, wallet.address);

    // Pull USDC out: SWPRC → USDC
    if (poolUsdc >= DUST_USDC && wb.SWPRC > 0n) {
      let chunk = ethers.parseUnits(CHUNK_SWPRC, 18);
      if (chunk > wb.SWPRC) chunk = (wb.SWPRC * 90n) / 100n;
      if (chunk > 0n) {
        const r = await trySwap(pool, wallet, tokenContracts.SWPRC, 2, 0, chunk);
        if (r) acted = true;
      }
    }

    poolRaw = await pool.getBalances();
    const wb2 = await walletBalances(provider, wallet.address);

    // Pull EURC out: USDC → EURC
    if (fmt(poolRaw[1], 6) >= DUST_USDC && wb2.USDC > 0n) {
      let chunk = ethers.parseUnits(CHUNK_USDC, 6);
      if (chunk > wb2.USDC) chunk = (wb2.USDC * 90n) / 100n;
      if (chunk > 0n) {
        const r = await trySwap(pool, wallet, tokenContracts.USDC, 0, 1, chunk);
        if (r) acted = true;
      }
    }

    poolRaw = await pool.getBalances();
    const wb3 = await walletBalances(provider, wallet.address);

    // Recover SWPRC stuck in pool: USDC → SWPRC
    if (fmt(poolRaw[2], 18) >= 1 && wb3.USDC > 0n) {
      let chunk = ethers.parseUnits("500", 6);
      if (chunk > wb3.USDC) chunk = (wb3.USDC * 50n) / 100n;
      if (chunk > 0n) {
        const r = await trySwap(pool, wallet, tokenContracts.USDC, 0, 2, chunk);
        if (r) acted = true;
      }
    }

    poolRaw = await printState(`After round ${round}`, provider, pool, wallet.address);

    if (!acted) {
      console.log("\nNo actionable swap this round — pool or treasury too thin. Stopping.");
      break;
    }
    if (!DRY_RUN) await sleep(PAUSE_MS);
  }

  console.log("\nDrain script finished.");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
