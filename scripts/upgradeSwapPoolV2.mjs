/**
 * Deploy new StableSwapPoolV2 implementation and UUPS-upgrade the proxy.
 *
 * Env: MY_PK (treasury owner), ARC_RPC_URL, SWAP_POOL_ADDRESS (optional)
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { SWAP_POOL_OWNER_ADDRESS } from "../lib/swapPoolConfig.js";
import { compileSolidity, getArtifact } from "./lib/compileSolidity.mjs";

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = String(process.env.MY_PK || "").trim();

const POOL_ABI = [
  "function owner() view returns (address)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function getBalances() view returns (uint256[])",
];

async function loadDeployment() {
  const raw = await fs.readFile("data/deployments/swap-pool-v2.latest.json", "utf8");
  return JSON.parse(raw);
}

async function main() {
  if (!PRIVATE_KEY) throw new Error("Set MY_PK in .env");

  const deployment = await loadDeployment();
  const proxy = process.env.SWAP_POOL_ADDRESS || deployment.proxy;
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  if (wallet.address.toLowerCase() !== SWAP_POOL_OWNER_ADDRESS.toLowerCase()) {
    throw new Error(`MY_PK is ${wallet.address}, expected ${SWAP_POOL_OWNER_ADDRESS}`);
  }

  const pool = new ethers.Contract(proxy, POOL_ABI, wallet);
  const owner = await pool.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet is not pool owner (${owner})`);
  }

  const before = await pool.getBalances();
  console.log("Proxy:", proxy);
  console.log("Current implementation:", deployment.implementation);
  console.log("Balances before upgrade:", before.map((b) => b.toString()).join(", "));

  const poolSource = await fs.readFile(path.resolve("contracts", "StableSwapPoolV2.sol"), "utf8");
  console.log("Compiling fixed StableSwapPoolV2...");
  const contracts = compileSolidity({ "StableSwapPoolV2.sol": poolSource });
  const artifact = getArtifact(contracts, "StableSwapPoolV2.sol", "StableSwapPoolV2");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log("Deploying new implementation...");
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log("New implementation:", implAddress);

  console.log("Upgrading proxy (UUPS)...");
  const tx = await pool.upgradeToAndCall(implAddress, "0x");
  const receipt = await tx.wait();
  console.log("upgrade tx:", receipt.hash);

  const after = await pool.getBalances();
  console.log("Balances after upgrade:", after.map((b) => b.toString()).join(", "));

  deployment.implementation = implAddress;
  deployment.upgradedAt = new Date().toISOString();
  deployment.upgradeNote = "Fix _xp precision — avoid divide-by-zero for 8-decimal tokens";
  await fs.writeFile(
    "data/deployments/swap-pool-v2.latest.json",
    `${JSON.stringify(deployment, null, 2)}\n`,
    "utf8"
  );

  console.log("\nUpgrade complete. Run: npm run verify:swap-pool");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
