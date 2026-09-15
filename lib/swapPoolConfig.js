/**
 * Canonical swap-pool config.
 *
 * Addresses default to Arc TESTNET and are env-overridable for mainnet via
 * ./arcNetwork.js (ARC_TOKEN_USDC/_EURC/_SWPRC/_CIRCBTC) and
 * ARC_SWAP_POOL_ADDRESS / ARC_SWAP_POOL_OWNER_ADDRESS (the addresses you get
 * when deploying the StableSwapPoolV2 proxy on mainnet). See
 * docs/swaparc/operate/mainnet-go-live.md.
 */

import { ARC_TOKEN_ADDRESSES } from "./arcNetwork.js";
import { LP_POOLS } from "./lpPoolsConfig.js";

function envAddr(name, fallback) {
  const v = String(process.env[name] || "").trim();
  return v || fallback;
}

/** Canonical V2 swap pool proxy (UUPS). */
export const CANONICAL_SWAP_POOL_ADDRESS = envAddr(
  "ARC_SWAP_POOL_ADDRESS",
  "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560"
);

/** Swaparc treasury / canonical pool owner (on-chain history). */
export const SWAP_POOL_OWNER_ADDRESS = envAddr(
  "ARC_SWAP_POOL_OWNER_ADDRESS",
  "0xD4d3E342902766344075D06c94391e61A9bB7e60"
);

export const SWAP_POOL_TOKENS = [
  {
    symbol: "USDC",
    address: ARC_TOKEN_ADDRESSES.USDC,
    decimals: 6,
  },
  {
    symbol: "EURC",
    address: ARC_TOKEN_ADDRESSES.EURC,
    decimals: 6,
  },
  {
    symbol: "SWPRC",
    address: ARC_TOKEN_ADDRESSES.SWPRC,
    decimals: 6,
  },
  {
    symbol: "CircBTC",
    address: ARC_TOKEN_ADDRESSES.CircBTC,
    decimals: 8,
  },
];

export const DEFAULT_POOL_A = 200n;
export const DEFAULT_POOL_FEE_BPS = 4n;

/** Per-pair LP pools (Pools tab) — network-selected from ./lpPoolsConfig.js. */
export const LEGACY_LIQUIDITY_POOLS = LP_POOLS;

export function swapPoolAllowlistAddresses() {
  const out = new Set();
  const add = (addr) => {
    if (!addr) return;
    try {
      out.add(addr.toLowerCase());
    } catch {
      // skip invalid
    }
  };
  add(CANONICAL_SWAP_POOL_ADDRESS);
  for (const t of SWAP_POOL_TOKENS) add(t.address);
  for (const p of LEGACY_LIQUIDITY_POOLS) {
    add(p.poolAddress);
    add(p.lpToken);
  }
  return out;
}

export function swapPoolTokenIndices() {
  const out = {};
  SWAP_POOL_TOKENS.forEach((t, i) => {
    out[t.symbol] = i;
  });
  return out;
}

export function addressToSymbolMap() {
  const out = {};
  for (const t of SWAP_POOL_TOKENS) {
    out[t.address.toLowerCase()] = t.symbol;
  }
  return out;
}
