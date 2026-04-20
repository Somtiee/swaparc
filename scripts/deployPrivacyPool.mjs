/**
 * Deploy PoseidonT3 (linked library) + PrivPayGroth16Verifier + ZKPrivacyPool (production stack).
 * ARC testnet stores broken stubs for oversized monolithic pools; linking Poseidon keeps pool runtime ~3KB.
 *
 * Requires build/privpay/verification_key.json — generate with:
 *   npm run privpay:zk-artifacts
 * (or manually: snarkjs zkey export verificationkey … )
 *
 * Env:
 *   PRIVPAY_VERIFICATION_KEY_JSON — path to verification_key.json (default: build/privpay/verification_key.json)
 *   PRIVACY_POOL_TOKEN, ARC_RPC_URL, ARC_DEPLOYER_PRIVATE_KEY
 *   PRIVACY_POOL_MERKLE_HEIGHT — must match privpay_claim.circom levels (default 16)
 *
 * Loads repo root `.env` automatically (no need for -r dotenv/config on the CLI).
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import solc from "solc";
import { ethers } from "ethers";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.ARC_DEPLOYER_PRIVATE_KEY || "";
const TOKEN = (
  process.env.PRIVACY_POOL_TOKEN ||
  process.env.ARCPAY_USDC_ADDRESS ||
  "0x3600000000000000000000000000000000000000"
).trim();
const MERKLE_HEIGHT = Number(process.env.PRIVACY_POOL_MERKLE_HEIGHT || 16);
const VK_PATH = (
  process.env.PRIVPAY_VERIFICATION_KEY_JSON || path.resolve("build", "privpay", "verification_key.json")
).trim();

const poolPath = path.resolve("contracts", "ZKPrivacyPool.sol");
const verifierPath = path.resolve("contracts", "PrivPayGroth16Verifier.sol");
const poseidonPath = path.resolve("contracts", "PoseidonT3.sol");

/** SnarkJS ≥0.7 exports G1 as [x,y,z] with z=1; older vk used [x,y]. */
function toG1Solidity(a) {
  if (!Array.isArray(a)) throw new Error("Expected G1 array");
  if (a.length === 2) return [BigInt(a[0]), BigInt(a[1])];
  if (a.length === 3) {
    if (BigInt(a[2]) !== 1n) {
      throw new Error("Expected affine G1 (z=1); re-export verification_key.json");
    }
    return [BigInt(a[0]), BigInt(a[1])];
  }
  throw new Error("Expected G1 [x,y] or [x,y,z]");
}

/** SnarkJS exports G2 as three rows: x,y pairs then z=[1,0].
 * Solidity verifier expects each Fp2 limb as [c1, c0] (swapped from snarkjs JSON order).
 */
function toG2Solidity(g) {
  if (!Array.isArray(g)) throw new Error("Expected G2 array");
  if (g.length === 2) {
    return [
      [BigInt(g[0][1]), BigInt(g[0][0])],
      [BigInt(g[1][1]), BigInt(g[1][0])],
    ];
  }
  if (g.length === 3) {
    const z0 = BigInt(g[2][0]);
    const z1 = BigInt(g[2][1]);
    if (z0 !== 1n || z1 !== 0n) {
      throw new Error("Expected affine G2 (z=(1,0)); re-export verification_key.json");
    }
    return [
      [BigInt(g[0][1]), BigInt(g[0][0])],
      [BigInt(g[1][1]), BigInt(g[1][0])],
    ];
  }
  throw new Error("Expected G2 as 2 or 3 rows");
}

async function loadVkConstructorArgs() {
  const raw = await fs.readFile(VK_PATH, "utf8");
  const vk = JSON.parse(raw);
  if (vk.protocol !== "groth16") throw new Error("verification_key.json must be groth16");
  if (!Array.isArray(vk.IC) || vk.IC.length !== 6) {
    throw new Error(`Expected IC length 6 (5 public + constant), got ${vk.IC?.length}. Re-export vk after circuit change.`);
  }
  const alfa1 = toG1Solidity(vk.vk_alpha_1);
  const beta2 = toG2Solidity(vk.vk_beta_2);
  const gamma2 = toG2Solidity(vk.vk_gamma_2);
  const delta2 = toG2Solidity(vk.vk_delta_2);
  const ic = vk.IC.map((p) => toG1Solidity(p));
  return { alfa1, beta2, gamma2, delta2, ic };
}

const privacySource = await fs.readFile(poolPath, "utf8");
const verifierSource = await fs.readFile(verifierPath, "utf8");
const poseidonSource = await fs.readFile(poseidonPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "PoseidonT3.sol": { content: poseidonSource },
    "ZKPrivacyPool.sol": { content: privacySource },
    "PrivPayGroth16Verifier.sol": { content: verifierSource },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors?.length) {
  const fatals = output.errors.filter((e) => e.severity === "error");
  if (fatals.length) {
    throw new Error(fatals.map((e) => e.formattedMessage).join("\n"));
  }
}

const libArtifact = output.contracts["PoseidonT3.sol"]?.PoseidonT3;
const poolArtifact = output.contracts["ZKPrivacyPool.sol"]?.ZKPrivacyPool;
const verArtifact = output.contracts["PrivPayGroth16Verifier.sol"]?.PrivPayGroth16Verifier;
if (!libArtifact?.evm?.bytecode?.object) {
  throw new Error("Failed to compile PoseidonT3 library.");
}
if (!poolArtifact?.abi || !poolArtifact?.evm?.bytecode?.object) {
  throw new Error("Failed to compile ZKPrivacyPool.");
}
if (!verArtifact?.abi || !verArtifact?.evm?.bytecode?.object) {
  throw new Error("Failed to compile PrivPayGroth16Verifier.");
}

if (!PRIVATE_KEY) {
  throw new Error("Missing ARC_DEPLOYER_PRIVATE_KEY.");
}

const vkArgs = await loadVkConstructorArgs();

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const network = await provider.getNetwork();

console.log(`Deploying ZK PRIVPAY stack with ${wallet.address} chainId=${network.chainId}`);
console.log(`Pool token: ${TOKEN}, Merkle height: ${MERKLE_HEIGHT}`);
console.log(`Verification key: ${VK_PATH}`);

/** Arc testnet stores broken stubs for very large contracts; Poseidon is deployed as a linked library first. */
const libFactory = new ethers.ContractFactory([], libArtifact.evm.bytecode.object, wallet);
const poseidonLib = await libFactory.deploy();
await poseidonLib.waitForDeployment();
const libAddr = await poseidonLib.getAddress();
console.log(`PoseidonT3 library: ${libAddr}`);

let poolBytecode = poolArtifact.evm.bytecode.object;
const placeholders = poolBytecode.match(/__\$[0-9a-fA-F]{34}\$__/g);
if (!placeholders?.length) {
  throw new Error(
    "ZKPrivacyPool bytecode missing library placeholder — PoseidonT3.hash must be external (linked library)."
  );
}
const uniqPh = [...new Set(placeholders)];
if (uniqPh.length !== 1) {
  throw new Error(`Expected exactly one Poseidon link placeholder, got ${uniqPh.length}`);
}
const libHex = ethers.getAddress(libAddr).slice(2).toLowerCase();
poolBytecode = poolBytecode.split(uniqPh[0]).join(libHex);

const verFactory = new ethers.ContractFactory(verArtifact.abi, verArtifact.evm.bytecode.object, wallet);
const verifier = await verFactory.deploy(
  vkArgs.alfa1,
  vkArgs.beta2,
  vkArgs.gamma2,
  vkArgs.delta2,
  vkArgs.ic
);
await verifier.waitForDeployment();
const verifierAddr = await verifier.getAddress();
console.log(`PrivPayGroth16Verifier: ${verifierAddr}`);

const poolFactory = new ethers.ContractFactory(poolArtifact.abi, poolBytecode, wallet);
const pool = await poolFactory.deploy(TOKEN, verifierAddr, MERKLE_HEIGHT);
const poolDepTx = pool.deploymentTransaction();
console.log(`ZKPrivacyPool tx: ${poolDepTx?.hash || "n/a"}`);
const poolDeployRcpt = await poolDepTx.wait();
await pool.waitForDeployment();
const poolAddr = await pool.getAddress();
const poolDeployBlock = poolDeployRcpt?.blockNumber ?? null;
console.log(`ZKPrivacyPool: ${poolAddr}`);

const poolRuntimeBytes = ((await provider.getCode(poolAddr)).length - 2) / 2;
if (poolRuntimeBytes < 500) {
  console.warn(
    `Warning: pool runtime bytecode is only ${poolRuntimeBytes} bytes — chain may not have stored the contract; check explorer.`
  );
}

console.log("\nSet:");
console.log(`VITE_PRIVACY_POOL_ADDRESS=${poolAddr}`);
console.log(`PRIVACY_POOL_VERIFIER_ADDRESS=${verifierAddr}`);
console.log(`POSEIDON_T3_LIBRARY_ADDRESS=${libAddr}`);
if (poolDeployBlock != null) {
  console.log(`VITE_PRIVACY_POOL_FROM_BLOCK=${poolDeployBlock}`);
}
