import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import { getPrices } from "../../src/priceFetcher.js";
import {
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  V2_SWAP_POOL_ADDRESS,
} from "../../lib/swapPoolStatsConfig.js";

const RPC_URL = process.env.ARC_RPC_URL || "https://arc-testnet.drpc.org";
const SWAP_POOL_ADDRESS = V2_SWAP_POOL_ADDRESS;

const POOL_ABI = [
  "event Swapped(address indexed user, uint256 i, uint256 j, uint256 dx, uint256 dy)",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
];

const INDEX_TO_SYMBOL = SWAP_POOL_INDEX_TO_SYMBOL;

const DECIMALS = {
  ...SWAP_POOL_TOKEN_DECIMALS,
  USDG: 18,
  wETH: 18,
  wBTC: 8,
  SOL: 9,
  BTC: 8,
  ETH: 18,
};

const FALLBACK_PRICES = {
  USDC: 1,
  EURC: 1.06,
  SWPRC: 0.71,
  CircBTC: 94000,
  USDG: 1,
  wETH: 2500,
  wBTC: 45000,
  SOL: 100,
  BTC: 45000,
  ETH: 2500,
};

async function getTokenUsdPrice(symbol) {
  if (!symbol) return 0;
  try {
    const prices = await getPrices([symbol]);
    if (prices[symbol]) return prices[symbol];
  } catch (err) {
    console.error("Error fetching price for", symbol, err);
  }
  return FALLBACK_PRICES[symbol] || 0;
}

export function startIndexer() {
  if (globalThis.__swapIndexerRunning) {
    console.log("Swap Indexer already running");
    return;
  }
  globalThis.__swapIndexerRunning = true;

  console.log("Starting Swap Indexer (V2)...", SWAP_POOL_ADDRESS);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);

  contract.on("Swapped", async (user, i, j, dx, dy, event) => {
    try {
      const wallet = user.toLowerCase();
      const symbolIn = INDEX_TO_SYMBOL[Number(i)];
      const symbolOut = INDEX_TO_SYMBOL[Number(j)];
      let usdValue = 0;

      if (symbolIn === "USDC") {
        usdValue = Number(ethers.formatUnits(dx, DECIMALS.USDC));
      } else if (symbolOut === "USDC") {
        usdValue = Number(ethers.formatUnits(dy, DECIMALS.USDC));
      } else if (symbolIn) {
        try {
          const quote = await contract.get_dy(i, 0, dx);
          usdValue = Number(ethers.formatUnits(quote, DECIMALS.USDC));
        } catch (e) {
          console.error("get_dy failed, fallback to price fetcher", e);
          const decimals = DECIMALS[symbolIn] || 18;
          const amount = Number(ethers.formatUnits(dx, decimals));
          usdValue = amount * (await getTokenUsdPrice(symbolIn));
        }
      }

      const profileKey = `profile:${wallet}`;
      const newSwapCount = await kv.hincrby(profileKey, "swapCount", 1);
      const newSwapVolume = await kv.hincrbyfloat(profileKey, "swapVolume", usdValue);

      await kv.zadd("leaderboard:swapVolume", {
        score: Number(newSwapVolume),
        member: wallet,
      });

      console.log(
        `Indexed Swap: ${wallet} ${symbolIn || i}→${symbolOut || j} volume $${usdValue.toFixed(2)}. Total: $${newSwapVolume}`
      );
    } catch (err) {
      console.error("Error processing swap event:", err);
    }
  });
}
