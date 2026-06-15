import "dotenv/config";
import { ethers } from "ethers";
import { kv } from "../lib/server/kv.js";
import { claimSwapTxForIndexing } from "../lib/server/swapIndexDedup.js";
import {
  SWAP_INDEXER_V2_STATE_KEY,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
} from "../lib/swapPoolStatsConfig.js";

const PRIMARY_RPC_URL =
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const FALLBACK_RPC_URL = process.env.ARC_RPC_URL_FALLBACK || null;
const TERTIARY_RPC_URL = process.env.ARC_RPC_URL_TERTIARY || null;
const GET_DY_MIN_INTERVAL_MS = Number(
  process.env.INDEXER_GET_DY_MIN_INTERVAL_MS || 120
);
const POLL_MS = Number(process.env.INDEXER_POLL_MS || 8000);
const LOG_CHUNK_BLOCKS = Number(process.env.INDEXER_LOG_CHUNK_BLOCKS || 2000);
const HEARTBEAT_EVERY = Number(process.env.INDEXER_HEARTBEAT_EVERY || 6);
const SWAP_POOL_ADDRESS = V2_SWAP_POOL_ADDRESS;
const POOL_ABI = [
  "event Swapped(address indexed user, uint256 i, uint256 j, uint256 dx, uint256 dy)",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
];

const network = ethers.Network.from({
  name: "arc-testnet",
  chainId: 5042002,
});

function createProvider(url) {
  return new ethers.JsonRpcProvider(url, network, {
    batchMaxCount: 1,
    staticNetwork: network,
  });
}

const rpcEntries = [
  { label: "primary", url: PRIMARY_RPC_URL },
  ...(FALLBACK_RPC_URL ? [{ label: "fallback", url: FALLBACK_RPC_URL }] : []),
  ...(TERTIARY_RPC_URL ? [{ label: "tertiary", url: TERTIARY_RPC_URL }] : []),
].map((entry) => {
  const provider = createProvider(entry.url);
  return {
    ...entry,
    provider,
    pool: new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider),
  };
});

const getDyCache = new Map();
let lastGetDyAtMs = 0;

const USDC_INDEX = 0;
const INDEXER_STATE_KEY = SWAP_INDEXER_V2_STATE_KEY;
const ru = String(process.env.REDIS_URL || "").trim();
const hasRedis = ru.startsWith("redis://") || ru.startsWith("rediss://");
const hasUpstash =
  String(process.env.KV_REST_API_URL || "").trim() &&
  String(process.env.KV_REST_API_TOKEN || "").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBlockNumberWithFallback() {
  let lastErr = null;
  for (const entry of rpcEntries) {
    try {
      return await entry.provider.getBlockNumber();
    } catch (e) {
      lastErr = e;
      console.warn(
        `[RPC] ${entry.label} getBlockNumber failed:`,
        e?.message || e
      );
    }
  }
  throw lastErr || new Error("All RPC providers failed getBlockNumber");
}

async function throttleGetDy() {
  const now = Date.now();
  const waitMs = lastGetDyAtMs + GET_DY_MIN_INTERVAL_MS - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastGetDyAtMs = Date.now();
}

async function getDyWithFallback(i, dx) {
  const cacheKey = `${i}:${dx.toString()}`;
  if (getDyCache.has(cacheKey)) {
    return getDyCache.get(cacheKey);
  }

  let lastErr = null;
  for (const entry of rpcEntries) {
    try {
      await throttleGetDy();
      const out = await entry.pool.get_dy(i, USDC_INDEX, dx);
      getDyCache.set(cacheKey, out);
      return out;
    } catch (e) {
      lastErr = e;
      console.warn(`[RPC] ${entry.label} get_dy failed:`, e?.message || e);
    }
  }
  throw lastErr || new Error("All RPC providers failed get_dy");
}

async function querySwappedEvents(fromBlock, toBlock) {
  let lastErr = null;
  for (const entry of rpcEntries) {
    try {
      return await entry.pool.queryFilter("Swapped", fromBlock, toBlock);
    } catch (e) {
      lastErr = e;
      console.warn(
        `[RPC] ${entry.label} queryFilter failed:`,
        e?.message || e
      );
    }
  }
  throw lastErr || new Error("All RPC providers failed queryFilter");
}

async function usdVolumeForSwap(i, j, dx, dy) {
  const symbolIn = SWAP_POOL_INDEX_TO_SYMBOL[Number(i)];
  const symbolOut = SWAP_POOL_INDEX_TO_SYMBOL[Number(j)];

  if (symbolIn === "USDC") {
    return Number(ethers.formatUnits(dx, SWAP_POOL_TOKEN_DECIMALS.USDC));
  }
  if (symbolOut === "USDC") {
    return Number(ethers.formatUnits(dy, SWAP_POOL_TOKEN_DECIMALS.USDC));
  }
  if (symbolIn) {
    try {
      const quote = await getDyWithFallback(i, dx);
      return Number(ethers.formatUnits(quote, 6));
    } catch {
      return 0;
    }
  }
  return 0;
}

async function getStartingBlock() {
  try {
    const stored = await kv.get(INDEXER_STATE_KEY);
    if (stored && Number(stored) > 0) {
      console.log(`Resuming V2 indexer from stored block: ${stored}`);
      return Number(stored);
    }
  } catch (e) {
    console.warn("Failed to read indexer state from KV", e?.message || e);
  }

  if (SWAP_POOL_V2_FROM_BLOCK > 0) {
    console.log(
      `No stored state. Starting V2 from SWAP_POOL_V2_FROM_BLOCK=${SWAP_POOL_V2_FROM_BLOCK}`
    );
    await kv.set(INDEXER_STATE_KEY, SWAP_POOL_V2_FROM_BLOCK);
    return SWAP_POOL_V2_FROM_BLOCK;
  }

  try {
    const latest = await getBlockNumberWithFallback();
    console.log(`No stored state. Starting V2 from latest block ${latest}`);
    await kv.set(INDEXER_STATE_KEY, latest);
    return latest;
  } catch (e) {
    console.warn("Failed to get latest block from RPC, defaulting to 0", e?.message || e);
    return 0;
  }
}

async function flushWalletDeltas(walletDeltas) {
  for (const [wallet, { count, volume }] of walletDeltas.entries()) {
    try {
      const profileKey = `profile:${wallet}`;
      const newCount = await kv.hincrby(profileKey, "swapCount", count);
      const newVolume = await kv.hincrbyfloat(profileKey, "swapVolume", volume);

      await kv.zadd("leaderboard:swapCount", {
        score: Number(newCount),
        member: wallet,
      });
      await kv.zadd("leaderboard:swapVolume", {
        score: Number(newVolume),
        member: wallet,
      });

      console.log(
        `[RPC] Wallet ${wallet}: +${count} swaps, +$${volume.toFixed(
          2
        )} (count=${newCount}, volume=${newVolume})`
      );
    } catch (e) {
      console.error(
        `Failed to write aggregated stats for wallet ${wallet}:`,
        e?.message || e
      );
    }
  }
}

async function processSwappedEvents(events) {
  getDyCache.clear();
  const walletDeltas = new Map();

  for (const ev of events) {
    try {
      const txHash = ev.transactionHash || ev.log?.transactionHash;
      if (txHash && !(await claimSwapTxForIndexing(txHash))) {
        continue;
      }

      const wallet = String(ev.args?.user || ev.args?.[0] || "").toLowerCase();
      if (!wallet.startsWith("0x")) continue;

      const i = Number(ev.args?.i ?? ev.args?.[1]);
      const j = Number(ev.args?.j ?? ev.args?.[2]);
      const dx = ev.args?.dx ?? ev.args?.[3];
      const dy = ev.args?.dy ?? ev.args?.[4];

      const usd = await usdVolumeForSwap(i, j, dx, dy);
      if (!Number.isFinite(usd)) continue;

      const current = walletDeltas.get(wallet) || { count: 0, volume: 0 };
      current.count += 1;
      current.volume += usd;
      walletDeltas.set(wallet, current);
    } catch (err) {
      console.error(`Error processing swap event: ${err?.message || err}`);
    }
  }

  await flushWalletDeltas(walletDeltas);
  return walletDeltas.size;
}

async function startLiveIndexer() {
  console.log("Starting Live Swap Indexer (RPC Swapped events)...");

  if (!hasRedis && !hasUpstash) {
    console.error(
      "Missing REDIS_URL (recommended) or KV_REST_API_URL + KV_REST_API_TOKEN in env"
    );
    process.exit(1);
  }
  console.log(`KV mode: ${hasRedis ? "REDIS_URL" : "KV_REST"}`);

  console.log(
    `Connected RPCs: ${rpcEntries.map((r) => `${r.label}:${r.url}`).join(" | ")}`
  );
  console.log(`Tracking V2 swaps on ${SWAP_POOL_ADDRESS} via RPC logs`);

  let scanFrom = await getStartingBlock();
  console.log(`Live indexer starting from block ${scanFrom}`);

  let heartbeat = 0;

  while (true) {
    try {
      const head = await getBlockNumberWithFallback();

      if (head >= scanFrom) {
        let totalEvents = 0;
        let walletsUpdated = 0;
        let cursor = scanFrom;

        while (cursor <= head) {
          const chunkEnd = Math.min(cursor + LOG_CHUNK_BLOCKS - 1, head);
          const events = await querySwappedEvents(cursor, chunkEnd);
          totalEvents += events.length;
          if (events.length > 0) {
            walletsUpdated += await processSwappedEvents(events);
          }
          cursor = chunkEnd + 1;
        }

        scanFrom = head + 1;
        await kv.set(INDEXER_STATE_KEY, scanFrom);

        if (totalEvents > 0) {
          console.log(
            `[RPC] Indexed ${totalEvents} swap event(s); cursor now ${scanFrom} (head was ${head})`
          );
        } else {
          heartbeat += 1;
          if (heartbeat % HEARTBEAT_EVERY === 0) {
            console.log(
              `[RPC] Heartbeat: pool ${SWAP_POOL_ADDRESS}, cursor ${scanFrom}, chain head ${head}`
            );
          }
        }
      }
    } catch (e) {
      console.error("[RPC] Indexer loop error:", e?.message || e);
    }

    await sleep(POLL_MS);
  }
}

startLiveIndexer().catch((err) => {
  console.error("Indexer failed to start:", err);
  process.exit(1);
});
