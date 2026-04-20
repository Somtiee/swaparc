/**
 * Generate Groth16 proof (requires compiled wasm + zkey).
 *
 * Setup once (dev only — use production ceremony for mainnet):
 *   snarkjs powersoftau new 16 pot16_0000.ptau -v
 *   snarkjs powersoftau contribute pot16_0000.ptau pot16_0001.ptau -e="dev"
 *   snarkjs powersoftau prepare phase2 pot16_0001.ptau pot16_final.ptau -v
 *   snarkjs groth16 setup build/privpay/privpay_claim.r1cs pot16_final.ptau build/privpay/privpay_claim_0000.zkey
 *   snarkjs zkey contribute build/privpay/privpay_claim_0000.zkey build/privpay/privpay_claim_0001.zkey -e="dev"
 *   snarkjs zkey verify build/privpay/privpay_claim.r1cs pot16_final.ptau build/privpay/privpay_claim_0001.zkey
 *   snarkjs zkey export verificationkey build/privpay/privpay_claim_0001.zkey build/privpay/verification_key.json
 *   mv build/privpay/privpay_claim_0001.zkey build/privpay/privpay_claim_final.zkey
 *
 * Run:
 *   node scripts/privpayProveCli.mjs
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
import { generatePrivpayPoolProof, parsePrivpayPublicSignals } from "../src/utils/privpayProof.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const wasm = process.env.PRIVPAY_WASM ?? path.join(root, "build", "privpay", "privpay_claim_js", "privpay_claim.wasm");
const zkey = process.env.PRIVPAY_ZKEY ?? path.join(root, "build", "privpay", "privpay_claim_final.zkey");

if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) {
  console.error("Missing wasm or zkey. Run circuit compile + trusted setup, then set PRIVPAY_WASM / PRIVPAY_ZKEY.\n");
  console.error("  wasm:", wasm, fs.existsSync(wasm));
  console.error("  zkey:", zkey, fs.existsSync(zkey));
  process.exit(1);
}

const secret = ethers.hexlify(ethers.randomBytes(32));
const nullifier = ethers.hexlify(ethers.randomBytes(32));
const amount = 10n ** 18n;
const recipient = "0x1111111111111111111111111111111111111111";

const tree = await PrivacyPoolPoseidonMerkleMirror.create(PRIVPAY_CIRCUIT_LEVELS);
const leaf = await computePrivpayNoteLeafBytes(secret, nullifier, amount, recipient);
await tree.insert(leaf);

const { root, pathElements, pathIsRight } = await tree.getMerkleProof(0, 1);
const input = await buildPrivpayCircuitInput({
  secretHex: secret,
  nullifierHex: nullifier,
  amountWei: amount,
  recipientAddress: recipient,
  rootBytes: root,
  path: { pathElements, pathIsRight },
});

const out = await generatePrivpayPoolProof(input, wasm, zkey);
const parsed = parsePrivpayPublicSignals(out.publicSignals);
console.log("publicSignals:", out.publicSignals);
console.log("parsed:", parsed);
console.log("proofBytes length:", (out.proofBytes.length - 2) / 2, "bytes");

const payload = {
  root: parsed.root,
  nullifierHash: parsed.nullifierHash,
  amount: parsed.amount.toString(),
  recipient: parsed.recipient,
  noteCommitment: parsed.noteCommitment,
  proof: out.proofBytes,
};
fs.writeFileSync(path.join(root, "build", "privpay", "last_proof.json"), JSON.stringify(payload, null, 2));
console.log("Wrote build/privpay/last_proof.json");
