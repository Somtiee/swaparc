/**
 * Swap-pool addresses and indexer settings for stats (legacy + V2 cumulative).
 */

export const LEGACY_SWAP_POOL_ADDRESS =
  "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";

export const V2_SWAP_POOL_ADDRESS =
  process.env.SWAP_POOL_ADDRESS || "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560";

/** Arcscan tail cursor for V2 only (separate from legacy indexer state). */
export const SWAP_INDEXER_V2_STATE_KEY = "swapIndexer:v2:lastBlock";

/** First block to scan for V2 swap txs (set after deploy; 0 = from genesis). */
export const SWAP_POOL_V2_FROM_BLOCK = Number(
  process.env.SWAP_POOL_V2_FROM_BLOCK || 0
);

export const SWAP_POOL_INDEX_TO_SYMBOL = {
  0: "USDC",
  1: "EURC",
  2: "SWPRC",
  3: "CircBTC",
};

export const SWAP_POOL_TOKEN_DECIMALS = {
  USDC: 6,
  EURC: 6,
  SWPRC: 6,
  CircBTC: 8,
};

export const SWAP_POOLS_FOR_STATS = [
  { id: "legacy", address: LEGACY_SWAP_POOL_ADDRESS, active: false },
  { id: "v2", address: V2_SWAP_POOL_ADDRESS, active: true },
];
