/**
 * Deploy pairwise LP pools (same SwaparcPoolV2 + SwaparcLP as existing Pools tab).
 *
 * Default on Arc TESTNET: the three CircBTC pairs (the original run — the
 * USDC/EURC, USDC/SWPRC, EURC/SWPRC pools predate this script).
 * On any other chain (e.g. mainnet): deploys ALL SIX pairs, since a fresh
 * network needs every pool.
 *
 * Override with ARC_LP_DEPLOY_PAIRS=all or a comma list, e.g.
 *   ARC_LP_DEPLOY_PAIRS=usdc-eurc,usdc-swprc
 *
 * Env:
 *   MY_PK or ARC_DEPLOYER_PRIVATE_KEY
 *   ARC_RPC_URL — mainnet RPC when deploying there
 *
 * Writes data/deployments/lp-pools-circbtc.latest.json and prints the
 * ARC_LP_POOLS_JSON value to paste into the VPS .env / Vercel (server +
 * browser pool list).
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { ARC_TESTNET_CHAIN_ID, ARC_PUBLIC_RPC } from "../lib/arcNetwork.js";
import { ARC_TOKEN_ADDRESSES } from "../lib/lpPoolsConfig.js";
import { compileSolidity, getArtifact } from "./lib/compileSolidity.mjs";

const RPC_URL = process.env.ARC_RPC_URL || ARC_PUBLIC_RPC;
const PRIVATE_KEY = String(
  process.env.MY_PK || process.env.ARC_DEPLOYER_PRIVATE_KEY || ""
).trim();

if (!PRIVATE_KEY) {
  throw new Error("Missing MY_PK or ARC_DEPLOYER_PRIVATE_KEY in .env");
}

const poolSource = await fs.readFile(
  path.resolve("contracts", "SwaparcPoolV2.sol"),
  "utf8"
);
const lpSource = await fs.readFile(
  path.resolve("contracts", "SwaparcLP.sol"),
  "utf8"
);

console.log("Compiling SwaparcPoolV2 + SwaparcLP (optimizer off, matching Arcscan)...");
const contracts = compileSolidity(
  {
    "SwaparcLP.sol": lpSource,
    "SwaparcPoolV2.sol": poolSource,
  },
  { optimizer: false }
);

const poolArtifact = getArtifact(contracts, "SwaparcPoolV2.sol", "SwaparcPoolV2");

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const network = await provider.getNetwork();
const balance = await provider.getBalance(wallet.address);

console.log(`Deployer: ${wallet.address}`);
console.log(`Chain ID: ${network.chainId}`);
console.log(`Balance: ${ethers.formatEther(balance)} ARC`);

if (balance === 0n) {
  throw new Error("Deployer has zero ARC for gas");
}

const ALL_PAIRS = [
  {
    id: "usdc-eurc",
    name: "USDC / EURC",
    tokens: ["USDC", "EURC"],
  },
  {
    id: "usdc-swprc",
    name: "USDC / SWPRC",
    tokens: ["USDC", "SWPRC"],
  },
  {
    id: "eurc-swprc",
    name: "EURC / SWPRC",
    tokens: ["EURC", "SWPRC"],
  },
  {
    id: "usdc-circbtc",
    name: "USDC / CircBTC",
    tokens: ["USDC", "CircBTC"],
  },
  {
    id: "eurc-circbtc",
    name: "EURC / CircBTC",
    tokens: ["EURC", "CircBTC"],
  },
  {
    id: "swprc-circbtc",
    name: "SWPRC / CircBTC",
    tokens: ["SWPRC", "CircBTC"],
  },
];

const TESTNET_DEFAULT_PAIR_IDS = ["usdc-circbtc", "eurc-circbtc", "swprc-circbtc"];

const pairsOverride = String(process.env.ARC_LP_DEPLOY_PAIRS || "").trim();
let PAIRS;
if (pairsOverride === "all") {
  PAIRS = ALL_PAIRS;
} else if (pairsOverride) {
  const wanted = pairsOverride.split(",").map((s) => s.trim()).filter(Boolean);
  PAIRS = ALL_PAIRS.filter((p) => wanted.includes(p.id));
  if (PAIRS.length !== wanted.length) {
    throw new Error(`Unknown pair id(s) in ARC_LP_DEPLOY_PAIRS: ${pairsOverride}`);
  }
} else {
  // Testnet keeps the historical 3 CircBTC pairs; any fresh network (mainnet) gets all six.
  PAIRS =
    Number(network.chainId) === ARC_TESTNET_CHAIN_ID
      ? ALL_PAIRS.filter((p) => TESTNET_DEFAULT_PAIR_IDS.includes(p.id))
      : ALL_PAIRS;
}
console.log(`Pairs to deploy: ${PAIRS.map((p) => p.id).join(", ")}`);

const poolFactory = new ethers.ContractFactory(
  poolArtifact.abi,
  poolArtifact.bytecode,
  wallet
);

const deployed = [];

for (const pair of PAIRS) {
  const tokenAddrs = pair.tokens.map((sym) => {
    const addr = ARC_TOKEN_ADDRESSES[sym];
    if (!addr) throw new Error(`Missing token address for ${sym}`);
    return ethers.getAddress(addr);
  });

  console.log(`\nDeploying ${pair.name}...`);
  console.log(`  tokens: ${pair.tokens.join(", ")}`);
  console.log(`  addresses: ${tokenAddrs.join(", ")}`);

  const pool = await poolFactory.deploy(tokenAddrs);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  const lpToken = await pool.lpToken();

  const entry = {
    id: pair.id,
    name: pair.name,
    tokens: pair.tokens,
    poolAddress,
    lpToken,
  };
  deployed.push(entry);
  console.log(`  poolAddress: ${poolAddress}`);
  console.log(`  lpToken:     ${lpToken}`);
}

console.log("\n========== DEPLOYED CIRCBTC LP POOLS ==========");
for (const e of deployed) {
  console.log(
    JSON.stringify(
      {
        id: e.id,
        name: e.name,
        tokens: e.tokens,
        poolAddress: e.poolAddress,
        lpToken: e.lpToken,
      },
      null,
      2
    ) + ","
  );
}

const outDir = path.resolve("data", "deployments");
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "lp-pools-circbtc.latest.json");
await fs.writeFile(
  outPath,
  JSON.stringify(
    {
      deployedAt: new Date().toISOString(),
      chainId: Number(network.chainId),
      deployer: wallet.address,
      pools: deployed,
    },
    null,
    2
  )
);
console.log(`\nWrote ${outPath}`);

console.log("\n========== NEXT STEP: paste this into your env ==========");
console.log(
  "Set ARC_LP_POOLS_JSON (VPS .env AND Vercel) to the single line below:"
);
console.log(JSON.stringify(deployed));
