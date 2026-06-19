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

/** Legacy V1 per-pair pools used by the Liquidity UI (Pools tab). */
export const LEGACY_LIQUIDITY_POOLS = [
  {
    id: "usdc-eurc",
    poolAddress: "0xd22e4fB80E21e8d2C91131eC2D6b0C000491934B",
    lpToken: "0x454f21b7738A446f79ea4ff00e71b9e8E9E6FEE9",
  },
  {
    id: "usdc-swprc",
    poolAddress: "0x613bc8A188a571e7Ffe3F884FabAB0F43ABB8282",
    lpToken: "0x2E2C7B48B2422223aD9628DA159f304192c24d3B",
  },
  {
    id: "eurc-swprc",
    poolAddress: "0x9463DE67E73B42B2cE5e45cab7e32184B9c24939",
    lpToken: "0xb81816d4fBB3D33b56c3efc04675d1cDed0f68b1",
  },
];

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
