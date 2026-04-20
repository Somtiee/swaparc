import "dotenv/config";
import { ethers } from "ethers";

const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const ARCSCAN_API = "https://testnet.arcscan.app/api";
const START_BLOCK = Number(process.env.COUNT_SWAPPERS_START_BLOCK || 0);
const END_BLOCK = Number(process.env.COUNT_SWAPPERS_END_BLOCK || 999999999);
const INCLUDE_FAILED_TXS =
  String(process.env.COUNT_SWAPPERS_INCLUDE_FAILED || "false").toLowerCase() ===
  "true";

// Decode pool method calls from tx input (works even when contract emits no swap events)
const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)"
]);

async function main() {
  let startBlock = START_BLOCK;
  const uniqueWallets = new Set();
  let totalTxs = 0;
  let totalSwapCalls = 0;

  while (true) {
    const url =
      `${ARCSCAN_API}?module=account&action=txlist` +
      `&address=${SWAP_POOL_ADDRESS}` +
      `&startblock=${startBlock}&endblock=${END_BLOCK}&sort=asc`;

    console.log("Fetching txs:", url);

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result || data.result.length === 0) {
      console.log("No more transactions from Arcscan.");
      break;
    }

    for (const tx of data.result) {
      try {
        totalTxs += 1;

        if (!INCLUDE_FAILED_TXS && tx.isError === "1") continue;
        if (!tx.input || tx.input === "0x") continue;

        let decoded = null;
        try {
          decoded = iface.parseTransaction({ data: tx.input });
        } catch {
          // Not a pool.swap call
        }

        if (decoded?.name === "swap" && tx.from) {
          totalSwapCalls += 1;
          uniqueWallets.add(String(tx.from).toLowerCase());
        }
      } catch (err) {
        console.error(`Error processing tx ${tx.hash}:`, err.message || err);
      }
    }

    const lastTx = data.result[data.result.length - 1];
    const lastBlock = Number(lastTx.blockNumber);

    console.log(
      `Processed up to block ${lastBlock}. txs=${totalTxs}, swapCalls=${totalSwapCalls}, uniqueSwapWallets=${uniqueWallets.size}`
    );

    // Move startBlock forward
    startBlock = lastBlock + 1;
  }

  console.log("========================================");
  console.log("Total transactions scanned:", totalTxs);
  console.log("Total swap() calls:", totalSwapCalls);
  console.log("Total unique wallets that called swap():", uniqueWallets.size);
  console.log("========================================");
}

main().catch((err) => {
  console.error("countUniqueSwappers crashed:", err);
  process.exit(1);
});