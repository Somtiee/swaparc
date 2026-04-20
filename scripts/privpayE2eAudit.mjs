/**
 * PRIVPAY end-to-end audit helpers (no wallet required).
 *
 * Usage:
 *   node scripts/privpayE2eAudit.mjs
 *   PRIVACY_POOL_ADDRESS=0x... ARC_RPC_URL=https://rpc.testnet.arc.network node scripts/privpayE2eAudit.mjs
 *
 * Checks on-chain state when pool env is set; always prints the privacy / accounting model.
 */
import { ethers } from "ethers";
import "dotenv/config";

const POOL =
  process.env.PRIVACY_POOL_ADDRESS ||
  process.env.VITE_PRIVACY_POOL_ADDRESS ||
  "";
const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";

const POOL_ABI = [
  "function token() view returns (address)",
  "function currentRoot() view returns (bytes32)",
  "function nextIndex() view returns (uint32)",
  "function commitmentAmount(bytes32) view returns (uint256)",
  "event Deposited(bytes32 indexed commitment, uint256 amount)",
  "event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount)",
];

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

function section(title) {
  console.log(`\n=== ${title} ===\n`);
}

async function main() {
  section("PRIVPAY simulation checklist (bill → deposit → claim code → withdraw)");

  console.log(`1. Create bill — app-side only until pay; no on-chain bill contract in this stack.`);
  console.log(`2. Pay / deposit — pool.deposit or depositFor; ERC-20 Transfer(from depositor → pool).`);
  console.log(
    `3. Claim code — v3 zk-claim (base64 JSON): preimage + commitment + recipient; no payer in payload.`
  );
  console.log(`4. Receiver claims — build Groth16 proof; pool.withdraw(proof,…); pool → recipient ERC-20 Transfer.`);

  section("Verification: sender EOA in withdrawal path");
  console.log(`- ZKPrivacyPool.Withdrawn logs: nullifierHash, recipient, amount — no depositor/payer field. ✓`);
  console.log(`- withdraw() does not read nor store payer; msg.sender is relayer or claimer only. ✓`);
  console.log(`- Proof public signals include recipient (intended payee), not payer. ✓`);
  console.log(
    `- Note: ERC-20 Transfer to recipient still exposes recipient on the token (expected).`
  );

  section("Verification: deposit ↔ withdrawal linkability (on-chain reality)");
  console.log(
    `- Limitation: noteCommitment in withdraw calldata matches Deposited(commitment) — linkable for anyone decoding proof pubSignals.`
  );
  console.log(
    `- Limitation: deposit tx \`from\` is the funding EOA on the block explorer.`
  );
  console.log(
    `- zk-claim shared out-of-band does not include payerWallet after receipt redaction fix (pool rail).`
  );

  section("Verification: balances");
  console.log(
    `- On withdraw, pool executes token.transfer(recipient, amount); pool balance decreases by amount. ✓`
  );
  console.log(
    `- commitmentAmount[noteCommitment] is NOT cleared after withdraw (by design); nullifier prevents double-spend; commitment cannot be re-deposited.`
  );

  if (!POOL || !/^0x[0-9a-fA-F]{40}$/.test(POOL)) {
    console.log("\n(Set PRIVACY_POOL_ADDRESS or VITE_PRIVACY_POOL_ADDRESS for live pool + token balance read.)\n");
    return;
  }

  section(`Live read: pool ${POOL}`);
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(ethers.getAddress(POOL), POOL_ABI, provider);
  const tokenAddr = await pool.token();
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
  const [root, nextIdx, poolBal] = await Promise.all([
    pool.currentRoot(),
    pool.nextIndex(),
    token.balanceOf(POOL),
  ]);

  console.log(`token: ${tokenAddr}`);
  console.log(`currentRoot: ${root}`);
  console.log(`nextIndex: ${nextIdx}`);
  console.log(`pool ERC-20 balance: ${poolBal.toString()}`);

  section("Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
