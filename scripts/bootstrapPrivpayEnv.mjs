/**
 * Fills empty PRIVPAY-related .env fields. Run: node scripts/bootstrapPrivpayEnv.mjs
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");

function randHex(nBytes) {
  return randomBytes(nBytes).toString("hex");
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env");
    process.exit(1);
  }

  let text = fs.readFileSync(envPath, "utf8");
  const defaultRpc = "https://rpc.testnet.arc.network";
  const changes = [];

  function fillEmpty(key, value) {
    const re = new RegExp(`^${key}=\\s*$`, "m");
    if (re.test(text)) {
      text = text.replace(re, `${key}=${value}`);
      changes.push(key);
      return true;
    }
    return false;
  }

  function setIfMissing(key, value) {
    const re = new RegExp(`^${key}=`, "m");
    if (!re.test(text)) {
      text = text.trimEnd() + `\n${key}=${value}\n`;
      changes.push(key);
      return;
    }
    fillEmpty(key, value);
  }

  fillEmpty("PRIVPAY_RELAY_RL_PEPPER", randHex(32));
  /* Leave PRIVPAY_RELAY_SERVER_SECRET empty unless you proxy relay from your backend (browser cannot safely hold it). */

  let deployerWallet;
  if (/^ARC_DEPLOYER_PRIVATE_KEY=\s*$/m.test(text)) {
    deployerWallet = ethers.Wallet.createRandom();
    text = text.replace(/^ARC_DEPLOYER_PRIVATE_KEY=\s*$/m, `ARC_DEPLOYER_PRIVATE_KEY=${deployerWallet.privateKey}`);
    changes.push("ARC_DEPLOYER_PRIVATE_KEY");
  }

  let relayerWallet;
  if (/^PRIVACY_POOL_RELAYER_PRIVATE_KEY=\s*$/m.test(text)) {
    relayerWallet = ethers.Wallet.createRandom();
    text = text.replace(
      /^PRIVACY_POOL_RELAYER_PRIVATE_KEY=\s*$/m,
      `PRIVACY_POOL_RELAYER_PRIVATE_KEY=${relayerWallet.privateKey}`
    );
    changes.push("PRIVACY_POOL_RELAYER_PRIVATE_KEY");
  }

  let arcRpc = defaultRpc;
  const arcMatch = text.match(/^ARC_RPC_URL=(.*)$/m);
  if (arcMatch && String(arcMatch[1]).trim()) {
    arcRpc = String(arcMatch[1]).trim().replace(/^["']|["']$/g, "");
  } else {
    text = text.replace(/^ARC_RPC_URL=\s*$/m, `ARC_RPC_URL=${defaultRpc}`);
    changes.push("ARC_RPC_URL");
  }

  fillEmpty("VITE_ARC_RPC_URL", arcRpc);

  text = text.replace(
    /^#\s*VITE_PRIVPAY_WASM_URL=.*$/m,
    "VITE_PRIVPAY_WASM_URL=/circuits/privpay/privpay_claim.wasm"
  );
  text = text.replace(
    /^#\s*VITE_PRIVPAY_ZKEY_URL=.*$/m,
    "VITE_PRIVPAY_ZKEY_URL=/circuits/privpay/privpay_claim_final.zkey"
  );
  if (!/^VITE_PRIVPAY_WASM_URL=/m.test(text)) {
    setIfMissing("VITE_PRIVPAY_WASM_URL", "/circuits/privpay/privpay_claim.wasm");
  } else {
    fillEmpty("VITE_PRIVPAY_WASM_URL", "/circuits/privpay/privpay_claim.wasm");
  }
  if (!/^VITE_PRIVPAY_ZKEY_URL=/m.test(text)) {
    setIfMissing("VITE_PRIVPAY_ZKEY_URL", "/circuits/privpay/privpay_claim_final.zkey");
  } else {
    fillEmpty("VITE_PRIVPAY_ZKEY_URL", "/circuits/privpay/privpay_claim_final.zkey");
  }

  fs.writeFileSync(envPath, text, "utf8");

  console.log("Updated:", changes.length ? changes.join(", ") : "(no empty slots to fill for those keys)");
  if (deployerWallet) {
    console.log("\nFund deployer (ARC testnet gas):", deployerWallet.address);
  }
  if (relayerWallet) {
    console.log("Fund relayer if using relay:", relayerWallet.address);
  }
  console.log(
    "\nPool addresses: run circuit compile + snarkjs vk + npm run deploy:pool when circom is installed."
  );
}

main();
