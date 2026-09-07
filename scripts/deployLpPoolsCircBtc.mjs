/**
 * Deploy three CircBTC pairwise LP pools (same SwaparcPoolV2 + SwaparcLP as existing Pools tab).
 *
 * Pairs:
 *   1. USDC / CircBTC
 *   2. EURC / CircBTC
 *   3. SWPRC / CircBTC
 *
 * Constructor: SwaparcPoolV2(address[] _tokens) — deploys SwaparcLP internally.
 *
 * Env:
 *   MY_PK or ARC_DEPLOYER_PRIVATE_KEY
 *   ARC_RPC_URL — default https://rpc.testnet.arc.network
 *
 * Writes data/deployments/lp-pools-circbtc.latest.json
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { ARC_TOKEN_ADDRESSES } from "../lib/lpPoolsConfig.js";
import { compileSolidity, getArtifact } from "./lib/compileSolidity.mjs";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
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

const PAIRS = [
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
