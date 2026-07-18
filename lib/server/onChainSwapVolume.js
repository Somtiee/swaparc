/**
 * USD volume as on-chain USDC equivalent at swap execution (pool get_dy).
 */
import { ethers } from "ethers";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
} from "../swapPoolStatsConfig.js";

export { LEGACY_SWAP_POOL_ADDRESS, V2_SWAP_POOL_ADDRESS, SWAP_POOL_V2_FROM_BLOCK };

const USDC_INDEX = 0;
const POOL_ABI = ["function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)"];

export function symbolForIndex(i) {
  return SWAP_POOL_INDEX_TO_SYMBOL[Number(i)] || `token_${i}`;
}

function amountFromRaw(symbol, raw) {
  const decimals = SWAP_POOL_TOKEN_DECIMALS[symbol] || 6;
  const amount = Number(ethers.formatUnits(raw, decimals));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * USDC-equivalent notional at execution:
 * - USDC in → input amount
 * - USDC out → output amount (when dy known)
 * - else → get_dy(token_in → USDC) at swap block (execution pool rate)
 */
export async function usdVolumeUsdcEquivalent(i, j, dx, dy, quoteToUsdc, blockTag) {
  const symbolIn = symbolForIndex(i);
  const symbolOut = symbolForIndex(j);

  if (symbolIn === "USDC") {
    return amountFromRaw("USDC", dx);
  }
  if (symbolOut === "USDC" && dy != null) {
    return amountFromRaw("USDC", dy);
  }
  if (typeof quoteToUsdc === "function") {
    return quoteToUsdc(Number(i), dx, blockTag);
  }
  return 0;
}

/** @deprecated Use usdVolumeUsdcEquivalent */
export function usdVolumeFromSwapInput(tokenIndex, dx) {
  const symbol = symbolForIndex(tokenIndex);
  if (symbol !== "USDC" && symbol !== "EURC") return 0;
  return amountFromRaw(symbol, dx);
}

/** @deprecated Use usdVolumeUsdcEquivalent */
export function usdVolumeFromSwappedLegs(i, j, dx, dy) {
  const inSym = symbolForIndex(i);
  const outSym = symbolForIndex(j);
  if (inSym === "USDC" || inSym === "EURC") return amountFromRaw(inSym, dx);
  if (outSym === "USDC" || outSym === "EURC") return amountFromRaw(outSym, dy);
  return 0;
}

function rpcUrls() {
  const urls = [
    process.env.ARC_RPC_URL,
    process.env.ARC_RPC_FALLBACK_URL,
    "https://rpc.testnet.arc.network",
    "https://arc-testnet.drpc.org",
  ]
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("http"));
  return [...new Set(urls)];
}

export function createPoolUsdcQuoter(poolAddress, opts = {}) {
  const urls = opts.rpcUrls || rpcUrls();
  const concurrency = Math.max(1, Number(opts.concurrency || process.env.VOLUME_QUOTE_CONCURRENCY || 1));
  const defaultInterval = concurrency > 1 ? 0 : 25;
  const minIntervalMs = Number(
    opts.minIntervalMs ?? process.env.VOLUME_GET_DY_INTERVAL_MS ?? defaultInterval
  );
  const pools = urls.map((url) => {
    const provider = new ethers.JsonRpcProvider(url);
    return { url, pool: new ethers.Contract(poolAddress, POOL_ABI, provider) };
  });
  const cache = new Map();
  let lastQuoteAt = 0;
  let quoteCalls = 0;
  let quoteFailures = 0;

  async function quoteToUsdc(i, dx, blockTag) {
    const tokenIndex = Number(i);
    if (tokenIndex === USDC_INDEX) {
      return amountFromRaw("USDC", dx);
    }

    const cacheKey = `${poolAddress}:${blockTag ?? "latest"}:${tokenIndex}:${dx.toString()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const now = Date.now();
    const waitMs = lastQuoteAt + minIntervalMs - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastQuoteAt = Date.now();

    const callOpts = blockTag != null ? { blockTag: Number(blockTag) } : {};
    let usd = 0;
    for (const entry of pools) {
      try {
        const quote = await entry.pool.get_dy(tokenIndex, USDC_INDEX, dx, callOpts);
        usd = Number(ethers.formatUnits(quote, SWAP_POOL_TOKEN_DECIMALS.USDC));
        if (Number.isFinite(usd) && usd >= 0) break;
        usd = 0;
      } catch {
        /* try next RPC */
      }
    }

    if (!Number.isFinite(usd) || usd < 0) {
      usd = 0;
      quoteFailures += 1;
    }

    quoteCalls += 1;
    cache.set(cacheKey, usd);
    return usd;
  }

  return {
    quoteToUsdc,
    get quoteCalls() {
      return quoteCalls;
    },
    get quoteFailures() {
      return quoteFailures;
    },
    get concurrency() {
      return concurrency;
    },
  };
}

/** Run async tasks with at most `limit` in flight. */
export async function asyncPool(limit, items, worker) {
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let next = 0;

  async function runOne() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await worker(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runOne()));
  return results;
}

/**
 * Scale on-chain wallet volumes so landing total aligns with platform swap count (8M+).
 * Uses average $/swap from verified on-chain txs for the platform-indexed gap.
 */
export function scaleWalletVolumesToPlatform(walletVolumes, onChainSwapCount, platformSwapCount) {
  const onChain = Math.max(1, toNumber(onChainSwapCount));
  const platform = Math.max(onChain, toNumber(platformSwapCount));
  const factor = platform / onChain;
  if (factor <= 1.0001) {
    return { factor: 1, onChainVolume: sumMap(walletVolumes), platformVolume: sumMap(walletVolumes) };
  }

  let onChainVolume = 0;
  for (const [wallet, vol] of walletVolumes) {
    onChainVolume += toNumber(vol);
    walletVolumes.set(wallet, toNumber(vol) * factor);
  }
  return { factor, onChainVolume, platformVolume: onChainVolume * factor };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumMap(map) {
  let s = 0;
  for (const v of map.values()) s += toNumber(v);
  return s;
}
