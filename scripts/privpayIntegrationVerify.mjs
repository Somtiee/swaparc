/**
 * PRIVPAY integration checks (no live deposit required).
 * Run: node scripts/privpayIntegrationVerify.mjs
 *
 * - ABI/event privacy surface
 * - Commitment encoding round-trip (JS leaf ↔ hex ↔ bytes)
 * - Optional: Groth16 prove+parse when build/privpay artifacts exist
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { PrivacyPoolPoseidonMerkleMirror } from "./privacyPoolPoseidonMerkle.mjs";
import {
  buildPrivpayCircuitInput,
  computePrivpayNoteLeafBytes,
  PRIVPAY_CIRCUIT_LEVELS,
} from "../src/utils/privpayWitness.js";
import { parsePrivpayPublicSignals, generatePrivpayPoolProof } from "../src/utils/privpayProof.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const POOL_ABI = [
  "event Deposited(bytes32 indexed commitment, uint256 amount)",
  "event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount)",
  "function withdraw(bytes proof, bytes32 nullifierHash, address recipient, uint256 amount) external",
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function topic(iface, name) {
  const ev = iface.getEvent(name);
  return ev.topicHash;
}

async function main() {
  const iface = new ethers.Interface(POOL_ABI);
  const dep = iface.getEvent("Deposited");
  const w = iface.getEvent("Withdrawn");

  assert(dep.inputs.length === 2, "Deposited arg count");
  assert(
    dep.inputs[0].name === "commitment" && dep.inputs[1].name === "amount",
    "Deposited args"
  );
  assert(
    !String(dep.format("")).includes("sender") &&
      !String(dep.format("")).includes("depositor"),
    "Deposited must not name sender/depositor (EOA only appears in ERC20 Transfer)"
  );

  assert(w.inputs.length === 3, "Withdrawn arg count");
  assert(
    w.inputs[0].name === "nullifierHash" &&
      w.inputs[1].name === "recipient" &&
      w.inputs[2].name === "amount",
    "Withdrawn args"
  );
  assert(
    !String(w.format("")).includes("sender") &&
      !String(w.format("")).includes("depositor"),
    "Withdrawn must not expose payer EOA"
  );

  const wfn = iface.getFunction("withdraw");
  const s = wfn.format("full");
  assert(!s.includes("address sender"), "withdraw signature leak");

  console.log("[ok] Event topics:", {
    Deposited: topic(iface, "Deposited"),
    Withdrawn: topic(iface, "Withdrawn"),
  });

  const secret = ethers.hexlify(ethers.randomBytes(32));
  const nullifier = ethers.hexlify(ethers.randomBytes(32));
  const amountWei = 10n ** 6n;
  const recipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const leafBytes = await computePrivpayNoteLeafBytes(
    secret,
    nullifier,
    amountWei,
    recipient
  );
  const commitmentHex = ethers.hexlify(leafBytes);
  const back = ethers.getBytes(ethers.zeroPadValue(commitmentHex, 32));
  assert(back.length === 32 && leafBytes.length === 32, "leaf len 32");
  let same = true;
  for (let i = 0; i < 32; i++) if (back[i] !== leafBytes[i]) same = false;
  assert(same, "commitment hex round-trip");

  const tree = await PrivacyPoolPoseidonMerkleMirror.create(PRIVPAY_CIRCUIT_LEVELS);
  await tree.insert(leafBytes);
  const { root, pathElements, pathIsRight } = await tree.getMerkleProof(0, 1);
  const input = await buildPrivpayCircuitInput({
    secretHex: secret,
    nullifierHex: nullifier,
    amountWei,
    recipientAddress: recipient,
    rootBytes: root,
    path: { pathElements, pathIsRight },
  });

  const wasm = path.join(root, "build", "privpay", "privpay_claim_js", "privpay_claim.wasm");
  const zkey = path.join(root, "build", "privpay", "privpay_claim_final.zkey");
  if (fs.existsSync(wasm) && fs.existsSync(zkey)) {
    const out = await generatePrivpayPoolProof(input, wasm, zkey);
    const parsed = parsePrivpayPublicSignals(out.publicSignals);
    assert(parsed.recipient.toLowerCase() === recipient.toLowerCase(), "pub recipient");
    assert(parsed.amount === amountWei, "pub amount");
    assert(
      String(parsed.noteCommitment).toLowerCase() === commitmentHex.toLowerCase(),
      "pub noteCommitment matches deposit leaf"
    );
    console.log("[ok] Groth16 proof + public signals consistent with deposit commitment");
  } else {
    console.log(
      "[skip] No wasm/zkey at build/privpay — compile circuit to run full prove step"
    );
  }

  console.log("[ok] privpayIntegrationVerify: all checks passed");
}

main().catch((e) => {
  console.error("[fail]", e.message || e);
  process.exit(1);
});
