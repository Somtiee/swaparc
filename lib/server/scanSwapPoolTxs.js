/**
 * Scan Arcscan txlist for pool.swap() calls (no on-page Redis egress).
 */
import { ethers } from "ethers";

const ARCSCAN_API = "https://testnet.arcscan.app/api";

const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)",
]);

/**
 * @param {string} poolAddress
 * @param {{ startBlock?: number, endBlock?: number, includeFailed?: boolean }} opts
 * @returns {Promise<{ totalTxs: number, totalSwapCalls: number, uniqueWallets: Set<string>, walletDeltas: Map<string, { count: number, volume: number }> }>}
 */
export async function scanSwapPoolTxs(poolAddress, opts = {}) {
  const startBlock = Number(opts.startBlock ?? 0);
  const endBlock = Number(opts.endBlock ?? 999999999);
  const includeFailed = Boolean(opts.includeFailed);

  let cursor = startBlock;
  const uniqueWallets = new Set();
  const walletDeltas = new Map();
  let totalTxs = 0;
  let totalSwapCalls = 0;

  while (true) {
    const url =
      `${ARCSCAN_API}?module=account&action=txlist` +
      `&address=${poolAddress}` +
      `&startblock=${cursor}&endblock=${endBlock}&sort=asc`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result?.length) break;

    for (const tx of data.result) {
      totalTxs += 1;
      if (!includeFailed && tx.isError === "1") continue;
      if (!tx.input || tx.input === "0x") continue;

      let decoded;
      try {
        decoded = iface.parseTransaction({ data: tx.input });
      } catch {
        continue;
      }
      if (decoded?.name !== "swap" || !tx.from) continue;

      totalSwapCalls += 1;
      const wallet = String(tx.from).toLowerCase();
      uniqueWallets.add(wallet);

      const current = walletDeltas.get(wallet) || { count: 0, volume: 0 };
      current.count += 1;
      walletDeltas.set(wallet, current);
    }

    const lastBlock = Number(data.result[data.result.length - 1].blockNumber);
    cursor = lastBlock + 1;
  }

  return { totalTxs, totalSwapCalls, uniqueWallets, walletDeltas };
}

/**
 * Merge legacy + V2 scan results for landing aggregate keys.
 */
export function mergeSwapPoolScanResults(parts) {
  const uniqueWallets = new Set();
  let totalSwapCalls = 0;
  let totalTxs = 0;

  for (const part of parts) {
    totalSwapCalls += part.totalSwapCalls || 0;
    totalTxs += part.totalTxs || 0;
    for (const w of part.uniqueWallets || []) uniqueWallets.add(w);
  }

  return {
    totalTxs,
    totalSwapCalls,
    totalSwapCount: totalSwapCalls,
    uniqueSwapWallets: uniqueWallets.size,
    uniqueUsers: uniqueWallets.size,
  };
}
