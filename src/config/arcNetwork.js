/**
 * Single source of truth for the Arc network identity (browser side).
 *
 * Everything here defaults to today's Arc TESTNET values so existing builds
 * are unchanged. To go live on mainnet, set the VITE_ARC_* environment
 * variables at build time (Vercel → Settings → Environment Variables, then
 * redeploy) — no code changes required:
 *
 *   VITE_ARC_CHAIN_ID        mainnet chain id (from Arc's official announcement)
 *   VITE_ARC_CHAIN_NAME      wallet display name (e.g. "Arc")
 *   VITE_ARC_PUBLIC_RPC_URL  public mainnet RPC
 *   VITE_ARC_DRPC_RPC_URL    dRPC mainnet endpoint (browser read RPC, tried first)
 *   VITE_ARC_EXPLORER_URL    block explorer base (e.g. https://arcscan.app)
 *   VITE_ARC_TOKEN_USDC      / _EURC / _SWPRC / _CIRCBTC — official mainnet
 *                            token contract addresses
 *
 * Liquidity pools are deployed by us per network: on mainnet set
 * VITE_ARC_LP_POOLS_JSON to the JSON printed by `npm run deploy:lp-pools-circbtc`
 * (see docs/swaparc/operate/mainnet-go-live.md).
 */

export const ARC_TESTNET_CHAIN_ID = 5042002;

const TESTNET_CHAIN_NAME = "Arc Testnet";
const TESTNET_PUBLIC_RPC = "https://rpc.testnet.arc.network";
const TESTNET_DRPC_RPC = "https://arc-testnet.drpc.org";
const TESTNET_EXPLORER = "https://testnet.arcscan.app";

function envStr(name) {
  return String(import.meta.env[name] || "").trim();
}

function envNum(name) {
  const n = Number(envStr(name));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const ARC_CHAIN_ID_DEC = envNum("VITE_ARC_CHAIN_ID") || ARC_TESTNET_CHAIN_ID;
export const ARC_CHAIN_ID_HEX = "0x" + ARC_CHAIN_ID_DEC.toString(16);
export const ARC_IS_TESTNET = ARC_CHAIN_ID_DEC === ARC_TESTNET_CHAIN_ID;

export const ARC_CHAIN_NAME =
  envStr("VITE_ARC_CHAIN_NAME") || (ARC_IS_TESTNET ? TESTNET_CHAIN_NAME : "Arc");

export const ARC_PUBLIC_RPC = envStr("VITE_ARC_PUBLIC_RPC_URL") || TESTNET_PUBLIC_RPC;
export const ARC_DRPC_RPC = envStr("VITE_ARC_DRPC_RPC_URL") || TESTNET_DRPC_RPC;

export const ARC_EXPLORER_BASE = envStr("VITE_ARC_EXPLORER_URL") || TESTNET_EXPLORER;
export const ARC_EXPLORER_API = `${ARC_EXPLORER_BASE}/api`;

/** Explorer transaction link (used for every tx hash shown in the UI). */
export function arcExplorerTxUrl(txHash) {
  return `${ARC_EXPLORER_BASE}/tx/${txHash}`;
}

/**
 * Swap + LP token registry. Addresses come from env when set (mainnet),
 * otherwise the Arc testnet defaults below.
 */
const TESTNET_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    decimals: 6,
  },
  {
    symbol: "SWPRC",
    name: "SwapARC Token",
    address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
    decimals: 6,
  },
  {
    symbol: "CircBTC",
    name: "Circle Bitcoin",
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    decimals: 8,
  },
];

const TOKEN_ENV_VARS = {
  USDC: "VITE_ARC_TOKEN_USDC",
  EURC: "VITE_ARC_TOKEN_EURC",
  SWPRC: "VITE_ARC_TOKEN_SWPRC",
  CircBTC: "VITE_ARC_TOKEN_CIRCBTC",
};

export const ARC_TOKENS = TESTNET_TOKENS.map((t) => {
  const override = envStr(TOKEN_ENV_VARS[t.symbol]);
  return override ? { ...t, address: override } : t;
});

/**
 * Per-pair LP pools (Pools tab). Testnet history below. On mainnet, set
 * VITE_ARC_LP_POOLS_JSON (Vercel env, build time) to the single-line JSON the
 * deploy script prints — same value as ARC_LP_POOLS_JSON on the server.
 */
export const TESTNET_LIQUIDITY_POOLS = [
  {
    id: "usdc-eurc",
    name: "USDC / EURC",
    tokens: ["USDC", "EURC"],
    poolAddress: "0xd22e4fB80E21e8d2C91131eC2D6b0C000491934B",
    lpToken: "0x454f21b7738A446f79ea4ff00e71b9e8E9E6FEE9",
  },
  {
    id: "usdc-swprc",
    name: "USDC / SWPRC",
    tokens: ["USDC", "SWPRC"],
    poolAddress: "0x613bc8A188a571e7Ffe3F884FabAB0F43ABB8282",
    lpToken: "0x2E2C7B48B2422223aD9628DA159f304192c24d3B",
  },
  {
    id: "eurc-swprc",
    name: "EURC / SWPRC",
    tokens: ["EURC", "SWPRC"],
    poolAddress: "0x9463DE67E73B42B2cE5e45cab7e32184B9c24939",
    lpToken: "0xb81816d4fBB3D33b56c3efc04675d1cDed0f68b1",
  },
  {
    id: "usdc-circbtc",
    name: "USDC / CircBTC",
    tokens: ["USDC", "CircBTC"],
    poolAddress: "0xa9DcE051b330E79150D0437921C63c498CC1bE91",
    lpToken: "0x95BD0bB6a929f75872C1e1176c4B8Cb9B3e633a2",
  },
  {
    id: "eurc-circbtc",
    name: "EURC / CircBTC",
    tokens: ["EURC", "CircBTC"],
    poolAddress: "0xB725B7D06dCAeD7F13A9b7bEc63A98978079CeEE",
    lpToken: "0x8a44c2Af504B1646a279b959d62FA915D13e0F18",
  },
  {
    id: "swprc-circbtc",
    name: "SWPRC / CircBTC",
    tokens: ["SWPRC", "CircBTC"],
    poolAddress: "0x49C7117FB670f387B5BA9e4Ea174Ae60cA384055",
    lpToken: "0x089b4F57a841338cfb7EB0aF431F5b872AC31B1b",
  },
];

/** Mainnet pool list from VITE_ARC_LP_POOLS_JSON (printed by the deploy
 *  script); empty until you set it, which keeps the Pools tab honest. */
export const MAINNET_LIQUIDITY_POOLS = (() => {
  const raw = envStr("VITE_ARC_LP_POOLS_JSON");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("[arcNetwork] VITE_ARC_LP_POOLS_JSON is set but invalid — ignoring");
    return [];
  }
})();

export const LIQUIDITY_POOLS = ARC_IS_TESTNET
  ? TESTNET_LIQUIDITY_POOLS
  : MAINNET_LIQUIDITY_POOLS;
