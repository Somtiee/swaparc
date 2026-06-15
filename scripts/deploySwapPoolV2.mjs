/**
 * Deploy UUPS upgradeable StableSwapPoolV2 (proxy = canonical swap pool address).
 *
 * Env:
 *   MY_PK — must be the treasury key (deployer + owner = SWAP_POOL_OWNER_ADDRESS)
 *   ARC_DEPLOYER_PRIVATE_KEY — fallback only if MY_PK unset
 *   SWAP_POOL_OWNER_ADDRESS — expected owner (default: 0xD4d3… treasury)
 *   ARC_RPC_URL — default https://rpc.testnet.arc.network
 *   SWAP_POOL_A — amplification (default 200)
 *   SWAP_POOL_FEE_BPS — fee basis points (default 4)
 *
 * Writes data/deployments/swap-pool-v2.latest.json
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import {
  DEFAULT_POOL_A,
  DEFAULT_POOL_FEE_BPS,
  SWAP_POOL_OWNER_ADDRESS,
  SWAP_POOL_TOKENS,
} from "../lib/swapPoolConfig.js";
import { compileSolidity, getArtifact } from "./lib/compileSolidity.mjs";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const EXPECTED_OWNER = ethers.getAddress(
  process.env.SWAP_POOL_OWNER_ADDRESS || SWAP_POOL_OWNER_ADDRESS
);
const PRIVATE_KEY = String(process.env.MY_PK || process.env.ARC_DEPLOYER_PRIVATE_KEY || "").trim();
const POOL_A = BigInt(process.env.SWAP_POOL_A || DEFAULT_POOL_A);
const POOL_FEE_BPS = BigInt(process.env.SWAP_POOL_FEE_BPS || DEFAULT_POOL_FEE_BPS);

if (!PRIVATE_KEY) {
  throw new Error(
    "Missing MY_PK in .env — set it to the treasury private key for 0xD4d3… so deployer and owner match on-chain history."
  );
}

const poolSourcePath = path.resolve("contracts", "StableSwapPoolV2.sol");
const poolSource = await fs.readFile(poolSourcePath, "utf8");

const proxySource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SwaparcStableSwapProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
`;

console.log("Compiling StableSwapPoolV2 + ERC1967Proxy...");
const contracts = compileSolidity({
  "StableSwapPoolV2.sol": poolSource,
  "SwaparcStableSwapProxy.sol": proxySource,
});

const implArtifact = getArtifact(contracts, "StableSwapPoolV2.sol", "StableSwapPoolV2");
const proxyArtifact = getArtifact(
  contracts,
  "SwaparcStableSwapProxy.sol",
  "SwaparcStableSwapProxy"
);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

if (wallet.address.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) {
  throw new Error(
    `Deployer wallet is ${wallet.address} but expected treasury owner ${EXPECTED_OWNER}. ` +
      "Set MY_PK in .env to the treasury private key (0xD4d3…), not a different hot wallet."
  );
}

const network = await provider.getNetwork();
const balance = await provider.getBalance(wallet.address);

console.log(`Treasury deployer/owner: ${wallet.address}`);
console.log(`Chain ID: ${network.chainId}`);
console.log(`Balance: ${ethers.formatEther(balance)} ARC`);

if (balance === 0n) {
  throw new Error("Treasury has zero ARC for gas — fund 0xD4d3… before deploy.");
}

const tokenAddresses = SWAP_POOL_TOKENS.map((t) => t.address);
console.log("Initial tokens:", SWAP_POOL_TOKENS.map((t) => t.symbol).join(", "));

const implFactory = new ethers.ContractFactory(
  implArtifact.abi,
  implArtifact.bytecode,
  wallet
);
console.log("Deploying implementation...");
const impl = await implFactory.deploy();
await impl.waitForDeployment();
const implAddress = await impl.getAddress();
console.log(`Implementation: ${implAddress}`);

const iface = new ethers.Interface(implArtifact.abi);
const initData = iface.encodeFunctionData("initialize", [
  tokenAddresses,
  POOL_A,
  POOL_FEE_BPS,
]);

const proxyFactory = new ethers.ContractFactory(
  proxyArtifact.abi,
  proxyArtifact.bytecode,
  wallet
);
console.log("Deploying ERC1967 proxy + initialize...");
const proxy = await proxyFactory.deploy(implAddress, initData);
await proxy.waitForDeployment();
const proxyAddress = await proxy.getAddress();
console.log(`Swap pool proxy (canonical): ${proxyAddress}`);

const pool = new ethers.Contract(proxyAddress, implArtifact.abi, provider);
const tokenCount = await pool.getTokenCount();
const owner = await pool.owner();
const onChainA = await pool.A();
const onChainFee = await pool.fee();
const rates = await pool.getRates();

if (owner.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) {
  throw new Error(`Owner mismatch after deploy: ${owner}`);
}

const deployment = {
  network: "arc-testnet",
  chainId: Number(network.chainId),
  deployedAt: new Date().toISOString(),
  deployer: wallet.address,
  owner: owner,
  treasury: EXPECTED_OWNER,
  proxy: proxyAddress,
  implementation: implAddress,
  supersededProxies: ["0xA2E7a570adB1195260Da3D9761D0E87edA966C2d"],
  parameters: {
    A: onChainA.toString(),
    feeBps: onChainFee.toString(),
    maxFeeBps: "100",
  },
  security: {
    upgradeable: "UUPS",
    patterns: ["OpenZeppelin", "ReentrancyGuard", "SafeERC20", "Pausable"],
    auditStatus: "internal-review-only",
    doc: "docs/swaparc/security-and-privacy/swap-pool-v2-security.md",
  },
  tokens: SWAP_POOL_TOKENS.map((t, i) => ({
    index: i,
    symbol: t.symbol,
    address: t.address,
    decimals: t.decimals,
    rate: rates[i]?.toString(),
  })),
  tokenCount: Number(tokenCount),
};

const outDir = path.resolve("data", "deployments");
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "swap-pool-v2.latest.json");
await fs.writeFile(outPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

console.log("\n=== Deployment complete ===");
console.log(`Wrote ${outPath}`);
console.log("\nSet in .env (after migration cutover):");
console.log(`VITE_SWAP_POOL_ADDRESS=${proxyAddress}`);
console.log(`SWAP_POOL_ADDRESS=${proxyAddress}`);
console.log(`SWAP_POOL_IMPLEMENTATION=${implAddress}`);
console.log("\nVerify on Arcscan. Ops: npm run verify:swap-pool");
