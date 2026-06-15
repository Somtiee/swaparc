/** Canonical swap-pool token registry (Arc testnet). */

/** Canonical V2 swap pool proxy (UUPS). */
export const CANONICAL_SWAP_POOL_ADDRESS = "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560";

/** Swaparc treasury / canonical pool owner (on-chain history). */
export const SWAP_POOL_OWNER_ADDRESS = "0xD4d3E342902766344075D06c94391e61A9bB7e60";

export const SWAP_POOL_TOKENS = [
  {
    symbol: "USDC",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
  {
    symbol: "EURC",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    decimals: 6,
  },
  {
    symbol: "SWPRC",
    address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
    decimals: 6,
  },
  {
    symbol: "CircBTC",
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    decimals: 8,
  },
];

export const DEFAULT_POOL_A = 200n;
export const DEFAULT_POOL_FEE_BPS = 4n;

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
