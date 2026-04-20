/**
 * Prints the ARC deployer address from ARC_DEPLOYER_PRIVATE_KEY (never prints the key).
 * Usage: npm run privpay:deployer-address
 */
import "dotenv/config";
import { ethers } from "ethers";

const pk = String(process.env.ARC_DEPLOYER_PRIVATE_KEY || "").trim();
if (!pk) {
  console.error("Set ARC_DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}
let w;
try {
  w = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`);
} catch {
  console.error("ARC_DEPLOYER_PRIVATE_KEY is not a valid private key");
  process.exit(1);
}

console.log("Deployer address (fund THIS for npm run deploy:pool):");
console.log(w.address);
console.log(
  "\nThis is separate from your browser wallet. If you want to deploy from the wallet that already holds USDC, replace ARC_DEPLOYER_PRIVATE_KEY in .env with that wallet’s key (keep it secret; never commit)."
);

const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
try {
  const provider = new ethers.JsonRpcProvider(rpc);
  const bal = await provider.getBalance(w.address);
  console.log(`\nRPC balance (getBalance / native field): ${bal.toString()} wei-like units`);
} catch (e) {
  console.warn("\nCould not fetch balance:", e?.message || e);
}
