/**
 * LP pool presets (USDC/EURC, USDC/SWPRC, EURC/SWPRC + CircBTC pairs) — matches swaparc.app landing TVL.
 */

export const LP_POOLS = [
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

export const ARC_TOKEN_ADDRESSES = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
  CircBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};
