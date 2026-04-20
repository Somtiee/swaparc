import { ethers } from "ethers";

const DEPOSITED_ZK = "event Deposited(bytes32 commitment, uint256 amount)";
const ROOT_UPDATED_ZK = "event RootUpdated(bytes32 root, uint32 leafIndex)";

/**
 * Reads Merkle root + leaf index after `ZKPrivacyPool.deposit` for a given commitment.
 * Parses `Deposited(commitment, …)` then the following `RootUpdated(root, leafIndex)` from the same contract.
 */
export function extractPoolRootFromDepositReceipt(receipt, poolAddress, expectedCommitment) {
  if (!receipt?.logs?.length) return null;
  const want = String(expectedCommitment).toLowerCase();
  const pool = String(poolAddress).toLowerCase();

  const ifaceD = new ethers.Interface([DEPOSITED_ZK]);
  const ifaceR = new ethers.Interface([ROOT_UPDATED_ZK]);
  const poolLogs = receipt.logs.filter((l) => String(l.address).toLowerCase() === pool);
  for (let i = 0; i < poolLogs.length; i++) {
    let pd;
    try {
      pd = ifaceD.parseLog(poolLogs[i]);
    } catch {
      continue;
    }
    if (pd?.name !== "Deposited") continue;
    if (String(pd.args.commitment).toLowerCase() !== want) continue;
    for (let j = i + 1; j < poolLogs.length; j++) {
      let pr;
      try {
        pr = ifaceR.parseLog(poolLogs[j]);
      } catch {
        continue;
      }
      if (pr?.name === "RootUpdated") {
        return { root: pr.args.root, leafIndex: Number(pr.args.leafIndex) };
      }
    }
    break;
  }
  return null;
}
