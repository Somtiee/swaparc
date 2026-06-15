import { kv } from "./kv.js";

const TTL_SEC = 90 * 86400;
const PREFIX = "swapIndexed:tx:v2:";

export function swapIndexedTxKey(txHash) {
  return `${PREFIX}${String(txHash).toLowerCase()}`;
}

/** @returns {Promise<boolean>} true when this caller should index the swap */
export async function claimSwapTxForIndexing(txHash) {
  const hash = String(txHash || "").trim();
  if (!hash.startsWith("0x") || hash.length < 10) return true;
  try {
    const claimed = await kv.set(swapIndexedTxKey(hash), "1", { nx: true, ex: TTL_SEC });
    return Boolean(claimed);
  } catch {
    return true;
  }
}
