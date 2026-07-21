import { kv } from "../../lib/server/kv.js";
import { ethers } from "ethers";
import { resolveCanonicalProfile } from "../../lib/server/profileKeys.js";
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
};

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
          console.error("get_dy failed for swap volume", e);
          usdValue = 0;
        }
      }

      const resolved = await resolveCanonicalProfile(kv, wallet);
      const profileKey = resolved.profileKey || `profile:${wallet}`;
      const memberId = resolved.memberId || wallet;
      const newSwapCount = await kv.hincrby(profileKey, "swapCount", 1);
      const newSwapVolume = await kv.hincrbyfloat(profileKey, "swapVolume", usdValue);

      await kv.zadd("leaderboard:swapCount", {
        score: Number(newSwapCount),
        member: memberId,
      });
      await kv.zadd("leaderboard:swapVolume", {
        score: Number(newSwapVolume),
        member: memberId,
      });

      console.log(
        `Indexed Swap: ${wallet}→${memberId} ${symbolIn || i}→${symbolOut || j} volume $${usdValue.toFixed(2)}. Total: $${newSwapVolume} count=${newSwapCount}`
      );
    } catch (err) {
      console.error("Error processing swap event:", err);
    }
  });
}
