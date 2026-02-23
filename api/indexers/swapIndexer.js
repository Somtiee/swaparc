import { kv } from "@vercel/kv";
import { ethers } from "ethers";
import { getPrices } from "../../src/priceFetcher.js";

const RPC_URL = "https://arc-testnet.drpc.org";
const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";

const POOL_ABI = [
  "event Swap(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
  "function getBalances() view returns (uint256[])",
  "function lpToken() view returns (address)",
  "function addLiquidity(uint256[] amounts)",
  "function removeLiquidity(uint256 lpAmount)",
  "function claimRewards()",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)"
];

const ADDRESS_TO_SYMBOL = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a": "EURC",
  "0xBE7477BF91526FC9988C8f33e91B6db687119D45": "SWPRC"
};

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

const ADDRESS_TO_INDEX = {
  [USDC_ADDRESS.toLowerCase()]: 0,
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": 1, // EURC
  "0xbe7477bf91526fc9988c8f33e91b6db687119d45": 2  // SWPRC
};

const DECIMALS = {
  USDC: 6,
  EURC: 6,
  SWPRC: 18,
  USDG: 18,
  wETH: 18,
  wBTC: 8,
  SOL: 9,
  BTC: 8,
  ETH: 18
};

const FALLBACK_PRICES = {
  USDC: 1,
  EURC: 1.06,
  SWPRC: 0.71,
  USDG: 1,
  wETH: 2500,
  wBTC: 45000,
  SOL: 100,
  BTC: 45000,
  ETH: 2500
};

async function getTokenUsdPrice(tokenAddress) {
  const symbol = ADDRESS_TO_SYMBOL[tokenAddress];
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

  console.log("Starting Swap Indexer...");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);

  contract.on("Swap", async (user, tokenIn, tokenOut, amountIn, amountOut, event) => {
    try {
      const wallet = user.toLowerCase();
      const tIn = tokenIn.toLowerCase();
      const tOut = tokenOut.toLowerCase();

      let usdValue = 0;

      // Logic: Prioritize USDC equivalent value
      if (tIn === USDC_ADDRESS.toLowerCase()) {
        // Input is USDC, so value is amountIn (6 decimals)
        usdValue = Number(ethers.formatUnits(amountIn, 6));
      } else if (tOut === USDC_ADDRESS.toLowerCase()) {
        // Output is USDC, so value is amountOut (6 decimals)
        usdValue = Number(ethers.formatUnits(amountOut, 6));
      } else {
        // Neither is USDC. Try to get on-chain quote (get_dy) to USDC.
        // We need the index of tokenIn in the pool.
        const idxIn = ADDRESS_TO_INDEX[tIn];
        const idxUsdc = 0; // USDC index assumed to be 0

        if (idxIn !== undefined) {
          try {
            // quote how much USDC (idx=0) we get for amountIn of tokenIn (idx=idxIn)
            const quote = await contract.get_dy(idxIn, idxUsdc, amountIn);
            usdValue = Number(ethers.formatUnits(quote, 6));
          } catch (e) {
            console.error("get_dy failed, fallback to price fetcher", e);
            // Fallback: use old logic
            const price = await getTokenUsdPrice(tokenIn);
            const symbol = ADDRESS_TO_SYMBOL[tokenIn];
            const decimals = (symbol && DECIMALS[symbol]) ? DECIMALS[symbol] : 18;
            const amount = Number(ethers.formatUnits(amountIn, decimals));
            usdValue = amount * price;
          }
        } else {
          // Unknown token index, fallback to price fetcher
          const price = await getTokenUsdPrice(tokenIn);
          const symbol = ADDRESS_TO_SYMBOL[tokenIn];
          const decimals = (symbol && DECIMALS[symbol]) ? DECIMALS[symbol] : 18;
          const amount = Number(ethers.formatUnits(amountIn, decimals));
          usdValue = amount * price;
        }
      }

      const profileKey = `profile:${wallet}`;
      
      // Update KV
      const newSwapCount = await kv.hincrby(profileKey, "swapCount", 1);
      // hincrbyfloat returns the new value as a string/number
      const newSwapVolume = await kv.hincrbyfloat(profileKey, "swapVolume", usdValue);
      
      // Update Leaderboard
      await kv.zadd("leaderboard:swapVolume", {
        score: Number(newSwapVolume),
        member: wallet
      });
      
      console.log(`Indexed Swap: ${wallet} volume $${usdValue.toFixed(2)}. Total: $${newSwapVolume}`);

    } catch (err) {
      console.error("Error processing swap event:", err);
    }
  });
}
