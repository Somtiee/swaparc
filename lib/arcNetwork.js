/**
 * Single source of truth for the Arc network identity (server / scripts).
 *
 * Server twin of src/config/arcNetwork.js. Everything defaults to today's
 * Arc TESTNET values; set the ARC_* environment variables (VPS .env /
 * Vercel) to go live on mainnet — no code changes required:
 *
 *   ARC_CHAIN_ID        mainnet chain id (from Arc's official announcement)
 *   ARC_PUBLIC_RPC_URL  public mainnet RPC (fallback; ARC_RPC_URL stays the
 *                       primary server RPC)
 *   ARC_DRPC_RPC_URL    dRPC mainnet endpoint
 *   ARC_EXPLORER_URL    block explorer base (e.g. https://arcscan.app)
 *   ARC_TOKEN_USDC      / _EURC / _SWPRC / _CIRCBTC — official mainnet token
 *                       contract addresses
 *
 * Liquidity pools are deployed by us per network — see MAINNET_LIQUIDITY_POOLS
 * in lib/lpPoolsConfig.js and docs/swaparc/operate/mainnet-go-live.md.
 */

export const ARC_TESTNET_CHAIN_ID = 5042002;

const TESTNET_PUBLIC_RPC = "https://rpc.testnet.arc.network";
const TESTNET_DRPC_RPC = "https://arc-testnet.drpc.org";
const TESTNET_EXPLORER = "https://testnet.arcscan.app";

function envStr(name) {
  return String(process.env[name] || "").trim();
}

function envNum(name) {
  const n = Number(envStr(name));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const ARC_CHAIN_ID_DEC =
  envNum("ARC_CHAIN_ID") || envNum("CHAIN_ID") || ARC_TESTNET_CHAIN_ID;
export const ARC_IS_TESTNET = ARC_CHAIN_ID_DEC === ARC_TESTNET_CHAIN_ID;

export const ARC_PUBLIC_RPC = envStr("ARC_PUBLIC_RPC_URL") || TESTNET_PUBLIC_RPC;
export const ARC_DRPC_RPC = envStr("ARC_DRPC_RPC_URL") || TESTNET_DRPC_RPC;

export const ARC_EXPLORER_BASE = envStr("ARC_EXPLORER_URL") || TESTNET_EXPLORER;
export const ARC_EXPLORER_API = `${ARC_EXPLORER_BASE}/api`;

/** Token registry — env overrides (mainnet) on top of testnet defaults.
 *  Keep in sync with src/config/arcNetwork.js (browser twin). */
const TESTNET_TOKENS = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
  CircBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};

const TOKEN_ENV_VARS = {
  USDC: "ARC_TOKEN_USDC",
  EURC: "ARC_TOKEN_EURC",
  SWPRC: "ARC_TOKEN_SWPRC",
  CircBTC: "ARC_TOKEN_CIRCBTC",
};

export const ARC_TOKEN_ADDRESSES = Object.fromEntries(
  Object.entries(TESTNET_TOKENS).map(([sym, addr]) => [
    sym,
    envStr(TOKEN_ENV_VARS[sym]) || addr,
  ])
);
