/**
 * LP pool presets (USDC/EURC, USDC/SWPRC, EURC/SWPRC + CircBTC pairs) — matches swaparc.app landing TVL.
 *
 * Token addresses are env-driven via ./arcNetwork.js (mainnet overrides),
 * and the pool list switches with the network: the testnet list below is the
 * default; on mainnet set ARC_LP_POOLS_JSON in the environment to the JSON
 * array printed by `npm run deploy:lp-pools-circbtc` (also saved to
 * data/deployments/lp-pools-circbtc.latest.json). See
 * docs/swaparc/operate/mainnet-go-live.md.
 */

import { ARC_IS_TESTNET } from "./arcNetwork.js";

export { ARC_TOKEN_ADDRESSES } from "./arcNetwork.js";

export const TESTNET_LP_POOLS = [
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

/**
 * Mainnet pool list, from the ARC_LP_POOLS_JSON env var. The deploy script
 * (`npm run deploy:lp-pools-circbtc` run against mainnet) prints the exact
 * JSON to paste — same shape as TESTNET_LP_POOLS above.
 */
function parseMainnetPools() {
  const raw = String(process.env.ARC_LP_POOLS_JSON || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch (err) {
    throw new Error(
      `ARC_LP_POOLS_JSON is set but invalid (${err.message}) — fix it in the environment or swaps/pool stats will misbehave`
    );
  }
}

export const LP_POOLS = ARC_IS_TESTNET
  ? TESTNET_LP_POOLS
  : parseMainnetPools();
