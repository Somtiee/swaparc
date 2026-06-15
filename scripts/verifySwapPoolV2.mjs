/**
 * Pre/post flight checks for StableSwapPoolV2 proxy.
 *
 * Usage:
 *   node scripts/verifySwapPoolV2.mjs
 *   node scripts/verifySwapPoolV2.mjs --swap-test
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
const SWAP_TEST = process.argv.includes("--swap-test");
const DRY_RUN = process.argv.includes("--dry-run");

const POOL_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function getTokenCount() view returns (uint256)",
  "function tokens(uint256) view returns (address)",
  "function getBalances() view returns (uint256[])",
  "function getRates() view returns (uint256[])",
  "function A() view returns (uint256)",
  "function fee() view returns (uint256)",
  "function get_dy(uint256,uint256,uint256) view returns (uint256)",
  "function swap(uint256,uint256,uint256) returns (uint256)",
  "function addToken(address)",
];

async function loadProxy() {
  if (process.env.SWAP_POOL_ADDRESS) return process.env.SWAP_POOL_ADDRESS;
  const raw = await fs.readFile("data/deployments/swap-pool-v2.latest.json", "utf8");
  return JSON.parse(raw).proxy;
}

function fmt(raw, dec) {
  return ethers.formatUnits(raw, dec);
}

async function main() {
  const proxy = await loadProxy();
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(proxy, POOL_ABI, provider);

  console.log("Verify V2 swap pool:", proxy);

  const [owner, paused, tokenCount, balances, rates, A, fee] = await Promise.all([
    pool.owner(),
    pool.paused(),
    pool.getTokenCount(),
    pool.getBalances(),
    pool.getRates(),
    pool.A(),
    pool.fee(),
  ]);

  if (owner.toLowerCase() !== SWAP_POOL_OWNER_ADDRESS.toLowerCase()) {
    throw new Error(`Owner mismatch: ${owner}`);
  }
  if (paused) throw new Error("Pool is paused");
  if (Number(tokenCount) !== SWAP_POOL_TOKENS.length) {
    throw new Error(`Expected ${SWAP_POOL_TOKENS.length} tokens, got ${tokenCount}`);
  }

  console.log("owner:", owner);
  console.log("paused:", paused);
  console.log("A:", A.toString(), "fee bps:", fee.toString());

  for (let i = 0; i < SWAP_POOL_TOKENS.length; i++) {
    const onChain = await pool.tokens(i);
    const t = SWAP_POOL_TOKENS[i];
    if (onChain.toLowerCase() !== t.address.toLowerCase()) {
      throw new Error(`Token ${i} mismatch: ${onChain} vs ${t.address}`);
    }
    console.log(
      `[${i}] ${t.symbol} ${t.address} pool=${fmt(balances[i], t.decimals)} rate=${rates[i]?.toString()}`
    );
  }

  const totalBal = balances.reduce((s, b) => s + b, 0n);
  if (totalBal === 0n) {
    console.log("WARN: pool has zero liquidity — get_dy/swap will fail until seeded");
    return;
  }

  const quotes = [
    [0, 1, "100", "USDC→EURC"],
    [0, 2, "100", "USDC→SWPRC"],
    [0, 3, "100", "USDC→CircBTC"],
    [1, 0, "100", "EURC→USDC"],
    [3, 0, "0.001", "CircBTC→USDC"],
  ];

  for (const [i, j, amt, label] of quotes) {
    const ti = SWAP_POOL_TOKENS[i];
    const tj = SWAP_POOL_TOKENS[j];
    const dx = ethers.parseUnits(amt, ti.decimals);
    const dy = await pool.get_dy(i, j, dx);
    if (!dy || dy === 0n) throw new Error(`${label} returned zero`);
    console.log(`${label}: in ${amt} → ~${fmt(dy, tj.decimals)} ${tj.symbol}`);
  }

  if (SWAP_TEST) {
    if (!PRIVATE_KEY) throw new Error("MY_PK required for --swap-test");
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const poolW = pool.connect(wallet);
    const usdc = new ethers.Contract(
      SWAP_POOL_TOKENS[0].address,
      [
        "function approve(address,uint256) returns (bool)",
        "function allowance(address,address) view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
      ],
      wallet
    );
    const dx = ethers.parseUnits("10", 6);
    const dy = await pool.get_dy(0, 1, dx);
    console.log(`\nSwap test USDC→EURC: 10 USDC → ~${fmt(dy, 6)} EURC`);
    if (DRY_RUN) {
      await poolW.swap.staticCall(0, 1, dx);
      console.log("swap staticCall OK (dry-run)");
    } else {
      const allowance = await usdc.allowance(wallet.address, proxy);
      if (allowance < dx) {
        const tx = await usdc.approve(proxy, ethers.MaxUint256);
        await tx.wait();
      }
      const tx = await poolW.swap(0, 1, dx);
      const receipt = await tx.wait();
      console.log("swap tx:", receipt.hash);
    }
  }

  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
