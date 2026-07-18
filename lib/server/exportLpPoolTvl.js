/**
 * Read on-chain LP pool balances + USD TVL (same logic as landing page).
 */

import { ethers } from "ethers";
import { LP_POOLS, ARC_TOKEN_ADDRESSES } from "../lpPoolsConfig.js";
import {
  V2_SWAP_POOL_ADDRESS,
  SWAP_POOL_TOKEN_DECIMALS,
} from "../swapPoolStatsConfig.js";

const POOL_ABI = [
  "function getBalances() view returns (uint256[])",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
];
const ERC20_ABI = ["function decimals() view returns (uint8)"];

const SWAP_TOKEN_INDEX = { USDC: 0, EURC: 1, SWPRC: 2, CircBTC: 3 };

export async function fetchLpPoolTvlSnapshot({ rpcUrl } = {}) {
  const rpc = rpcUrl || process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const provider = new ethers.JsonRpcProvider(rpc);
  const pricePool = new ethers.Contract(V2_SWAP_POOL_ADDRESS, POOL_ABI, provider);
  const refreshedAt = new Date().toISOString();

  async function priceInUsdc(symbol) {
    if (symbol === "USDC") return 1;
    const i = SWAP_TOKEN_INDEX[symbol];
    if (i == null) return 0;
    const dec = SWAP_POOL_TOKEN_DECIMALS[symbol] || 6;
    try {
      const one = ethers.parseUnits("1", dec);
      const dy = await pricePool.get_dy(i, 0, one);
      return Number(ethers.formatUnits(dy, 6));
    } catch {
      return 0;
    }
  }

  const pools = [];
  let totalTvlUsd = 0;

  for (const preset of LP_POOLS) {
    const pool = new ethers.Contract(preset.poolAddress, POOL_ABI, provider);
    const raw = await pool.getBalances();
    const [symA, symB] = preset.tokens;

    const tokenA = new ethers.Contract(ARC_TOKEN_ADDRESSES[symA], ERC20_ABI, provider);
    const tokenB = new ethers.Contract(ARC_TOKEN_ADDRESSES[symB], ERC20_ABI, provider);
    const [decA, decB, priceA, priceB] = await Promise.all([
      tokenA.decimals(),
      tokenB.decimals(),
      priceInUsdc(symA),
      priceInUsdc(symB),
    ]);

    const lockedA = Number(ethers.formatUnits(raw[0] ?? 0n, decA));
    const lockedB = Number(ethers.formatUnits(raw[1] ?? 0n, decB));
    const usdA = lockedA * priceA;
    const usdB = lockedB * priceB;
    const poolTvlUsd = usdA + usdB;
    totalTvlUsd += poolTvlUsd;

    pools.push({
      refreshedAt,
      poolId: preset.id,
      poolName: preset.name,
      poolAddress: preset.poolAddress,
      tokenASymbol: symA,
      tokenALocked: lockedA,
      tokenAUsd: usdA,
      tokenBSymbol: symB,
      tokenBLocked: lockedB,
      tokenBUsd: usdB,
      poolTvlUsd,
    });
  }

  return { refreshedAt, totalTvlUsd, activePools: pools.length, pools };
}
