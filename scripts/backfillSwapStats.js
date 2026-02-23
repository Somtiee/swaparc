import "dotenv/config";
import { ethers } from "ethers";
import { createClient } from "@vercel/kv";
import fs from "fs";
import path from "path";

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const CHECKPOINT_FILE = path.resolve("backfill_checkpoint.json");

const RPC_URL = "https://arc-testnet.drpc.org";
const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const POOL_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)"
]);

const USDC_INDEX = 0;

async function fetchPoolTransactions() {
  let startBlock = 0;
  let all = [];

  while (true) {
    const url = 
      `https://testnet.arcscan.app/api?module=account&action=txlist` + 
      `&address=${SWAP_POOL_ADDRESS}` + 
      `&startblock=${startBlock}&endblock=999999999&sort=asc`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result || data.result.length === 0) {
      break;
    }

    all = all.concat(data.result);
    console.log(`Fetched ${all.length} transactions...`);

    const lastTx = data.result[data.result.length - 1];
    startBlock = Number(lastTx.blockNumber) + 1;
  }

  return all;
}

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const data = fs.readFileSync(CHECKPOINT_FILE, "utf8");
      return JSON.parse(data);
    } catch (e) {
      console.warn("Failed to load checkpoint, starting fresh.", e);
    }
  }
  return { processedHashes: [], walletStats: {} };
}

function saveCheckpoint(data) {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
    console.log("Checkpoint saved.");
  } catch (e) {
    console.error("Failed to save checkpoint", e);
  }
}

async function backfill() {
  console.log("Starting robust backfill...");

  // Load state
  let { processedHashes, walletStats } = loadCheckpoint();
  const processedSet = new Set(processedHashes);
  console.log(`Loaded ${processedSet.size} processed transactions.`);
  console.log("SKIPPING fetch for now. Writing existing checkpoint data to KV immediately...");

  /* 
  // Commenting out the fetch loop to force immediate write
  try {
    const transactions = await fetchPoolTransactions();
    // ... (rest of the loop)
  } 
  */

  try {
    // Jump straight to writing
    console.log("Writing to KV...");
    const entries = Object.entries(walletStats);
    const BATCH_SIZE = 20; // Smaller batch size
    
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      
      try {
        await Promise.race([
          Promise.all(batch.map(([wallet, stats]) => 
            kv.hset(`profile:${wallet}`, {
              swapCount: stats.swapCount,
              swapVolume: stats.swapVolume
            })
          )),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
        ]);
        console.log(`Saved ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} wallets...`);
      } catch (err) {
        console.error(`Batch ${i} failed/timed out:`, err.message);
      }
    }

    console.log("Backfill complete.");
    process.exit(0);

  } catch (error) {
    console.error("Backfill crashed:", error);
    // Save state on crash attempt
    saveCheckpoint({
      processedHashes: Array.from(processedSet),
      walletStats
    });
    process.exit(1);
  }
}

backfill();
