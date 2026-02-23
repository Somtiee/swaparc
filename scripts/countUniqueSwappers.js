import "dotenv/config";
import { ethers } from "ethers";

const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const ARCSCAN_API = "https://testnet.arcscan.app/api";

// Same iface as in liveSwapIndexer.js
const iface = new ethers.Interface([
  "function swap(uint256 i,uint256 j,uint256 dx)"
]);

async function main() {
  let startBlock = 0;
  const endBlock = 999999999;
  const uniqueWallets = new Set();

  while (true) {
    const url =
      `${ARCSCAN_API}?module=account&action=txlist` +
      `&address=${SWAP_POOL_ADDRESS}` +
      `&startblock=${startBlock}&endblock=${endBlock}&sort=asc`;

    console.log("Fetching:", url);

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result || data.result.length === 0) {
      console.log("No more transactions from Arcscan.");
      break;
    }

    for (const tx of data.result) {
      try {
        if (!tx.input || tx.input === "0x") continue;

        // Only count real swap() calls
        let decoded;
        try {
          decoded = iface.parseTransaction({ data: tx.input });
        } catch {
          continue; // not the swap function
        }

        if (decoded?.name !== "swap") continue;

        if (tx.from) {
          uniqueWallets.add(tx.from.toLowerCase());
        }
      } catch (err) {
        console.error(`Error processing tx ${tx.hash}:`, err.message || err);
      }
    }

    const lastTx = data.result[data.result.length - 1];
    const lastBlock = Number(lastTx.blockNumber);

    console.log(
      `Processed up to block ${lastBlock}. Unique swap wallets so far: ${uniqueWallets.size}`
    );

    // Move startBlock forward to paginate beyond Arcscan's 10k limit
    startBlock = lastBlock + 1;
  }

  console.log("========================================");
  console.log("Total unique wallets that called swap():", uniqueWallets.size);
  console.log("========================================");
}

main().catch((err) => {
  console.error("countUniqueSwappers crashed:", err);
  process.exit(1);
});