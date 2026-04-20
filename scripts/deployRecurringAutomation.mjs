import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import solc from "solc";
import { ethers } from "ethers";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.ARC_DEPLOYER_PRIVATE_KEY || "";

if (!PRIVATE_KEY) {
  throw new Error("Missing ARC_DEPLOYER_PRIVATE_KEY in environment.");
}

const contractPath = path.resolve("contracts", "RecurringPoolAutomation.sol");
const source = await fs.readFile(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "RecurringPoolAutomation.sol": { content: source },
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

const artifact = output.contracts["RecurringPoolAutomation.sol"]?.RecurringPoolAutomation;
if (!artifact?.abi || !artifact?.evm?.bytecode?.object) {
  throw new Error("Failed to compile RecurringPoolAutomation.");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const network = await provider.getNetwork();
console.log(`Deploying RecurringPoolAutomation with ${wallet.address} on chainId=${network.chainId}`);

const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, wallet);
const contract = await factory.deploy();
const tx = contract.deploymentTransaction();
console.log(`Deployment tx: ${tx?.hash || "n/a"}`);
await contract.waitForDeployment();
const deployed = await contract.getAddress();

console.log(`RecurringPoolAutomation deployed at: ${deployed}`);
console.log("Set these env vars:");
console.log(`RECURRING_AUTOMATION_CONTRACT_ADDRESS=${deployed}`);
console.log(`VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS=${deployed}`);
