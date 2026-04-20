/**
 * Rebuild ordered leaf commitments for a ZK-style pool from `Deposited` logs.
 * Assumes every leaf is a Poseidon note digest (bytes32) as used by privpay circom + ZKPrivacyPool.
 *
 * ARC (and many RPCs) cap eth_getLogs to a small block span (e.g. 10,000). We chunk requests.
 * Set VITE_PRIVACY_POOL_FROM_BLOCK to the pool deployment block to avoid scanning from genesis.
 */
import { ethers } from "ethers";

const DEPOSITED = "event Deposited(bytes32 indexed commitment, uint256 amount)";

/** Stay under Arc's `eth_getLogs is limited to a 10,000 range` error. */
const MAX_LOG_BLOCK_SPAN = 9999;

/** Max chunk iterations before asking for deploy block (avoids thousands of RPC calls). */
const MAX_CHUNKS_SOFT_CAP = 400;

function defaultFromBlock() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_PRIVACY_POOL_FROM_BLOCK) {
    const n = Number(import.meta.env.VITE_PRIVACY_POOL_FROM_BLOCK);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

/**
 * @param {import("ethers").Provider} provider
 * @param {string} poolAddress
 * @param {number | "latest"} [toBlock]
 * @param {number} [fromBlockOverride] - first block to scan (pool creation block); overrides env
 */
export async function fetchZkPoolLeavesFromRpc(
  provider,
  poolAddress,
  toBlock = "latest",
  fromBlockOverride
) {
  const depositTopic = ethers.id("Deposited(bytes32,uint256)");
  const latestNum =
    toBlock === "latest" || toBlock === undefined
      ? await provider.getBlockNumber()
      : Number(toBlock);
  if (!Number.isFinite(latestNum)) {
    throw new Error("Invalid toBlock for pool log scan.");
  }

  const start =
    fromBlockOverride !== undefined && fromBlockOverride !== null
      ? Math.max(0, Math.floor(Number(fromBlockOverride)))
      : defaultFromBlock();

  const blockCount = latestNum - start + 1;
  const chunks = Math.ceil(blockCount / MAX_LOG_BLOCK_SPAN);
  if (chunks > MAX_CHUNKS_SOFT_CAP) {
    throw new Error(
      `Pool deposit log scan would need ${chunks} RPC requests (from block ${start}). ` +
        `Set VITE_PRIVACY_POOL_FROM_BLOCK to the block where this pool was deployed ` +
        `(printed by npm run deploy:pool, or from the contract creation tx on the explorer).`
    );
  }

  const allLogs = [];
  let cursor = start;
  while (cursor <= latestNum) {
    const chunkTo = Math.min(cursor + MAX_LOG_BLOCK_SPAN, latestNum);
    const logs = await provider.getLogs({
      address: poolAddress,
      fromBlock: cursor,
      toBlock: chunkTo,
      topics: [depositTopic],
    });
    allLogs.push(...logs);
    cursor = chunkTo + 1;
  }

  allLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
  const iface = new ethers.Interface([DEPOSITED]);
  const out = [];
  for (const log of allLogs) {
    const p = iface.parseLog(log);
    if (p?.name === "Deposited") {
      out.push(ethers.getBytes(ethers.zeroPadValue(p.args.commitment, 32)));
    }
  }
  return out;
}

export function findLeafIndex(leaves, commitmentBytes) {
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i].length === commitmentBytes.length) {
      let eq = true;
      for (let j = 0; j < leaves[i].length; j++) {
        if (leaves[i][j] !== commitmentBytes[j]) {
          eq = false;
          break;
        }
      }
      if (eq) return i;
    }
  }
  return -1;
}
