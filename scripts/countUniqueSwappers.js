import "dotenv/config";
import { ethers } from "ethers";

const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const ARCSCAN_API = "https://testnet.arcscan.app/api";

// Same iface as in liveSwapIndexer.js
const iface = new ethers.Interface([
  "event TokenExchange(address indexed buyer, int128 sold_id, uint256 tokens_sold, int128 bought_id, uint256 tokens_bought)",
  "event Swap(address indexed sender, address indexed tIn, address indexed tOut, uint256 amountIn, uint256 amountOut)"
]);

async function main() {
  let startBlock = 0;
  const endBlock = 999999999;
  const uniqueWallets = new Set();

  while (true) {
    const url =
      `${ARCSCAN_API}?module=logs&action=getLogs` +
      `&address=${SWAP_POOL_ADDRESS}` +
      `&fromBlock=${startBlock}&toBlock=${endBlock}&sort=asc`;

    console.log("Fetching logs:", url);

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "1" || !data.result || data.result.length === 0) {
      console.log("No more logs from Arcscan.");
      break;
    }

    for (const log of data.result) {
      try {
        let decoded;
        try {
          // Arcscan logs have 'topics' and 'data'. Ethers expects them.
          decoded = iface.parseLog({
            topics: log.topics,
            data: log.data,
          });
        } catch {
          continue; // not a relevant event
        }

        if (decoded?.name === "TokenExchange") {
          // args: [buyer, sold_id, tokens_sold, bought_id, tokens_bought]
          if (decoded.args[0]) {
            uniqueWallets.add(decoded.args[0].toLowerCase());
          }
        } else if (decoded?.name === "Swap") {
          // args: [sender, tIn, tOut, amountIn, amountOut]
          if (decoded.args[0]) {
            uniqueWallets.add(decoded.args[0].toLowerCase());
          }
        }
      } catch (err) {
        console.error(`Error processing log ${log.transactionHash}:`, err.message || err);
      }
    }

    const lastLog = data.result[data.result.length - 1];
    const lastBlock = Number(lastLog.blockNumber);

    console.log(
      `Processed up to block ${lastBlock}. Unique swap wallets so far: ${uniqueWallets.size}`
    );

    // Move startBlock forward
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