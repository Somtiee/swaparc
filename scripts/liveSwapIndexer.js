import "dotenv/config";
import { ethers } from "ethers";
import { kv } from "@vercel/kv";

const PRIMARY_RPC_URL =
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const FALLBACK_RPC_URL = process.env.ARC_RPC_URL_FALLBACK || null;
const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const POOL_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)"
];

const network = ethers.Network.from({
  name: "arc-testnet",
  chainId: 5042002,
});
const primaryProvider = new ethers.JsonRpcProvider(PRIMARY_RPC_URL, network);
const fallbackProvider = FALLBACK_RPC_URL
  ? new ethers.JsonRpcProvider(FALLBACK_RPC_URL, network)
  : null;
const primaryPool = new ethers.Contract(
  SWAP_POOL_ADDRESS,
  POOL_ABI,
  primaryProvider
);
const fallbackPool =
  fallbackProvider &&
  new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, fallbackProvider);
const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)"
]);

const USDC_INDEX = 0;
const ARCSCAN_API = "https://testnet.arcscan.app/api";
const INDEXER_STATE_KEY = "swapIndexer:lastBlock";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBlockNumberWithFallback() {
  try {
    return await primaryProvider.getBlockNumber();
  } catch (e) {
    if (fallbackProvider) {
      console.warn(
        "Primary RPC getBlockNumber failed, using fallback:",
        e?.message || e
      );
      return await fallbackProvider.getBlockNumber();
    }
    throw e;
  }
}

async function getDyWithFallback(i, dx) {
  try {
    return await primaryPool.get_dy(i, USDC_INDEX, dx);
  } catch (e) {
    if (fallbackPool) {
      console.warn(
        "Primary RPC get_dy failed, using fallback:",
        e?.message || e
      );
      return await fallbackPool.get_dy(i, USDC_INDEX, dx);
    }
    throw e;
  }
}

async function getStartingBlock() {
  try {
    const stored = await kv.get(INDEXER_STATE_KEY);
    if (stored && Number(stored) > 0) {
      console.log(`Resuming from stored last block: ${stored}`);
      return Number(stored);
    }
  } catch (e) {
    console.warn("Failed to read indexer state from KV", e?.message || e);
  }

  try {
    const latest = await getBlockNumberWithFallback();
    console.log(`No stored state. Starting from latest block ${latest}`);
    await kv.set(INDEXER_STATE_KEY, latest);
    return latest;
  } catch (e) {
    console.warn("Failed to get latest block from RPC, defaulting to 0", e?.message || e);
    return 0;
  }
}

async function fetchNewTransactions(fromBlock) {
  let startBlock = fromBlock;
  let lastProcessedBlock = fromBlock;
  const walletDeltas = new Map(); // wallet -> { count: number, volume: number }

  while (true) {
    const url =
      `${ARCSCAN_API}?module=account&action=txlist` +
      `&address=${SWAP_POOL_ADDRESS}` +
      `&startblock=${startBlock}&endblock=999999999&sort=asc`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result || data.result.length === 0) {
      break;
    }

    console.log(
      `Arcscan returned ${data.result.length} txs from block ${startBlock} (latest block in batch: ${data.result[data.result.length - 1].blockNumber})`
    );

    for (const tx of data.result) {
      try {
        if (!tx.input || tx.input === "0x") continue;

        let decoded;
        try {
          decoded = iface.parseTransaction({ data: tx.input });
        } catch {
          continue;
        }

        const wallet = tx.from.toLowerCase();
        const i = Number(decoded.args[0]);
        const dx = decoded.args[2];

        let usd = 0;

        // If tokenIn is USDC, the USD value is just the input amount
        if (i === USDC_INDEX) {
          usd = Number(ethers.formatUnits(dx, 6));
        } else {
          const usdcValue = await getDyWithFallback(i, dx);
          usd = Number(ethers.formatUnits(usdcValue, 6));
        }

        if (isNaN(usd) || !isFinite(usd)) continue;

        const current = walletDeltas.get(wallet) || { count: 0, volume: 0 };
        current.count += 1;
        current.volume += usd;
        walletDeltas.set(wallet, current);
      } catch (err) {
        console.error(`Error processing tx ${tx.hash}: ${err.message}`);
      }
    }

    const lastTx = data.result[data.result.length - 1];
    lastProcessedBlock = Number(lastTx.blockNumber);
    startBlock = lastProcessedBlock + 1;
  }

  // Flush aggregated deltas to KV in one go per wallet
  for (const [wallet, { count, volume }] of walletDeltas.entries()) {
    try {
      const profileKey = `profile:${wallet}`;
      const newCount = await kv.hincrby(profileKey, "swapCount", count);
      const newVolume = await kv.hincrbyfloat(profileKey, "swapVolume", volume);

      console.log(
        `[Arcscan] Wallet ${wallet}: +${count} swaps, +${volume.toFixed(
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

  return lastProcessedBlock;
}

async function startLiveIndexer() {
  console.log("Starting Live Swap Indexer (Arcscan tail mode)...");

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN in env");
    process.exit(1);
  }

  console.log(
    `Connected to primary RPC ${PRIMARY_RPC_URL}${
      FALLBACK_RPC_URL ? ` (fallback: ${FALLBACK_RPC_URL})` : ""
    }`
  );
  console.log(`Tracking swaps on ${SWAP_POOL_ADDRESS} via Arcscan...`);

  let lastBlock = await getStartingBlock();
  console.log(`Live indexer starting from block ${lastBlock}`);

  while (true) {
    try {
      const latestProcessed = await fetchNewTransactions(lastBlock);

      if (latestProcessed > lastBlock) {
        lastBlock = latestProcessed + 1;
        try {
          await kv.set(INDEXER_STATE_KEY, lastBlock);
        } catch (e) {
          console.warn("Failed to persist indexer state to KV", e?.message || e);
        }
      }
    } catch (e) {
      console.error("Arcscan tail loop error:", e.message || e);
    }

    await sleep(5000);
  }
}

startLiveIndexer().catch((err) => {
  console.error("Indexer failed to start:", err);
  process.exit(1);
});
