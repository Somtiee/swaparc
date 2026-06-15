/**
 * Seed V2 swap pool from treasury via addLiquidity.
 *
 * Default ratio (USDC anchor U):
 *   USDC = U, EURC = U/1.4, SWPRC = U/9, CircBTC = U/1_000_000
 *
 * Env:
 *   MY_PK — treasury (pool owner)
 *   SWAP_POOL_ADDRESS — V2 proxy (or read deployment JSON)
 *   SEED_USDC_ANCHOR — override U in human USDC (default: max balanced from treasury)
 *   SEED_DRY_RUN=1 — preview only
 *
 * Usage:
 *   npm run seed:swap-pool
 */
import "dotenv/config";
import fs from "node:fs/promises";
import { ethers } from "ethers";
import {
  SWAP_POOL_OWNER_ADDRESS,
  SWAP_POOL_TOKENS,
} from "../lib/swapPoolConfig.js";

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = String(process.env.MY_PK || "").trim();
const DRY_RUN = process.env.SEED_DRY_RUN === "1" || process.argv.includes("--dry-run");

const RATIO_EURC = 1 / 1.4;
const RATIO_SWPRC = 1 / 9;
const RATIO_CIRCBTC = 1 / 1_000_000;

const POOL_ABI = [
  "function addLiquidity(uint256[] amounts)",
  "function getBalances() view returns (uint256[])",
  "function owner() view returns (address)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function loadProxy() {
  if (process.env.SWAP_POOL_ADDRESS) return process.env.SWAP_POOL_ADDRESS;
  const raw = await fs.readFile("data/deployments/swap-pool-v2.latest.json", "utf8");
  return JSON.parse(raw).proxy;
}

function planAmounts(treasury, anchorOverride) {
  const dec = Object.fromEntries(SWAP_POOL_TOKENS.map((t) => [t.symbol, t.decimals]));

  const maxU = Math.min(
    Number(ethers.formatUnits(treasury.USDC, dec.USDC)),
    Number(ethers.formatUnits(treasury.EURC, dec.EURC)) / RATIO_EURC,
    Number(ethers.formatUnits(treasury.SWPRC, dec.SWPRC)) / RATIO_SWPRC,
    Number(ethers.formatUnits(treasury.CircBTC, dec.CircBTC)) / RATIO_CIRCBTC
  );

  const U = anchorOverride ? Number(anchorOverride) : maxU * 0.98;
  const human = {
    USDC: U,
    EURC: U * RATIO_EURC,
    SWPRC: U * RATIO_SWPRC,
    CircBTC: U * RATIO_CIRCBTC,
  };

  const wei = {
    USDC: ethers.parseUnits(human.USDC.toFixed(6), dec.USDC),
    EURC: ethers.parseUnits(human.EURC.toFixed(6), dec.EURC),
    SWPRC: ethers.parseUnits(human.SWPRC.toFixed(6), dec.SWPRC),
    CircBTC: ethers.parseUnits(human.CircBTC.toFixed(8), dec.CircBTC),
  };

  return { human, wei, maxU };
}

async function main() {
  if (!PRIVATE_KEY) throw new Error("Set MY_PK in .env");

  const proxy = await loadProxy();
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  if (wallet.address.toLowerCase() !== SWAP_POOL_OWNER_ADDRESS.toLowerCase()) {
    throw new Error(`MY_PK is ${wallet.address}, expected ${SWAP_POOL_OWNER_ADDRESS}`);
  }

  const pool = new ethers.Contract(proxy, POOL_ABI, wallet);
  const owner = await pool.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet is not pool owner (${owner})`);
  }

  const treasury = {};
  for (const t of SWAP_POOL_TOKENS) {
    const c = new ethers.Contract(t.address, ERC20_ABI, provider);
    treasury[t.symbol] = await c.balanceOf(wallet.address);
  }

  const override = process.env.SEED_USDC_ANCHOR;
  const { human, wei, maxU } = planAmounts(treasury, override);

  console.log("Seed V2 pool:", proxy);
  console.log("Treasury:", wallet.address);
  console.log("Max balanced USDC anchor:", maxU.toFixed(2));
  console.log("Planned seed:");
  for (const t of SWAP_POOL_TOKENS) {
    console.log(`  ${t.symbol}: ${human[t.symbol]}`);
  }

  for (const t of SWAP_POOL_TOKENS) {
    if (wei[t.symbol] > treasury[t.symbol]) {
      throw new Error(`Insufficient treasury ${t.symbol}`);
    }
  }

  const amounts = SWAP_POOL_TOKENS.map((t) => wei[t.symbol]);
  const before = await pool.getBalances();
  console.log("\nPool before:", SWAP_POOL_TOKENS.map((t, i) => `${t.symbol}=${ethers.formatUnits(before[i], t.decimals)}`).join(", "));

  if (DRY_RUN) {
    console.log("\nDRY RUN — no transactions");
    return;
  }

  for (const t of SWAP_POOL_TOKENS) {
    const c = new ethers.Contract(t.address, ERC20_ABI, wallet);
    const allowance = await c.allowance(wallet.address, proxy);
    if (allowance < wei[t.symbol]) {
      console.log(`Approving ${t.symbol}...`);
      const tx = await c.approve(proxy, ethers.MaxUint256);
      await tx.wait();
    }
  }

  console.log("addLiquidity...");
  const tx = await pool.addLiquidity(amounts);
  const receipt = await tx.wait();
  console.log("tx:", receipt.hash);

  const after = await pool.getBalances();
  console.log("\nPool after:", SWAP_POOL_TOKENS.map((t, i) => `${t.symbol}=${ethers.formatUnits(after[i], t.decimals)}`).join(", "));
  console.log("\nSeed complete.");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
