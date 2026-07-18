/**
 * Export SwapArc on-chain activity to Dune-ready CSV files (runs locally, Arcscan only).
 *
 * Usage: npm run stats:export-dune
 * Output: data/dune-export/*.csv
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { ethers } from "ethers";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
} from "../lib/swapPoolStatsConfig.js";

const ARCSCAN_API = "https://testnet.arcscan.app/api";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.DUNE_EXPORT_OUT_DIR || join(ROOT, "data/dune-export");

const REQUEST_DELAY_MS = Number(process.env.DUNE_EXPORT_DELAY_MS || 180);
const INCLUDE_LEGACY_SWAPS = String(process.env.DUNE_EXPORT_LEGACY || "true") !== "false";

const swapLogIface = new ethers.Interface([
  "event Swapped(address indexed user, uint256 i, uint256 j, uint256 dx, uint256 dy)",
  "event LiquidityAdded(uint256[] amounts)",
]);
const privLogIface = new ethers.Interface([
  "event Deposited(bytes32 indexed commitment, uint256 amount)",
  "event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount)",
]);
const swapTxIface = new ethers.Interface(["function swap(uint256 i,uint256 j,uint256 dx)"]);

const SWAPPED_TOPIC = swapLogIface.getEvent("Swapped").topicHash;
const LIQUIDITY_ADDED_TOPIC = swapLogIface.getEvent("LiquidityAdded").topicHash;
const DEPOSITED_TOPIC = privLogIface.getEvent("Deposited").topicHash;
const WITHDRAWN_TOPIC = privLogIface.getEvent("Withdrawn").topicHash;
const SWAP_SELECTOR = swapTxIface.getFunction("swap").selector;

const PRIVPAY_POOLS = [
  {
    token: "USDC",
    address:
      process.env.PRIVACY_POOL_ADDRESS_USDC ||
      process.env.VITE_PRIVACY_POOL_ADDRESS_USDC ||
      process.env.VITE_PRIVACY_POOL_ADDRESS ||
      "",
  },
  {
    token: "EURC",
    address:
      process.env.PRIVACY_POOL_ADDRESS_EURC ||
      process.env.VITE_PRIVACY_POOL_ADDRESS_EURC ||
      "",
  },
  {
    token: "SWPRC",
    address:
      process.env.PRIVACY_POOL_ADDRESS_SWPRC ||
      process.env.VITE_PRIVACY_POOL_ADDRESS_SWPRC ||
      "",
  },
].filter((p) => ethers.isAddress(p.address));

const PRIVPAY_FROM_BLOCK = Number(process.env.VITE_PRIVACY_POOL_FROM_BLOCK || 0);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

function symbolForIndex(i) {
  return SWAP_POOL_INDEX_TO_SYMBOL[Number(i)] || `token_${i}`;
}

function usdVolumeFromSwapInput(tokenIndex, dx) {
  const symbol = symbolForIndex(tokenIndex);
  if (symbol !== "USDC" && symbol !== "EURC") return 0;
  const decimals = SWAP_POOL_TOKEN_DECIMALS[symbol] || 6;
  const amount = Number(ethers.formatUnits(dx, decimals));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatTokenAmount(symbol, raw) {
  const decimals = SWAP_POOL_TOKEN_DECIMALS[symbol] || 6;
  return ethers.formatUnits(raw, decimals);
}

function parseBlockNumber(value) {
  const s = String(value || "0");
  if (s.startsWith("0x")) return Number.parseInt(s, 16);
  return Number(s);
}

function logIsoTime(log) {
  const ts = Number.parseInt(String(log.timeStamp || "0x0"), 16);
  return ts > 0 ? new Date(ts * 1000).toISOString() : "";
}

function cleanTopics(topics) {
  return (topics || []).filter((t) => t != null && t !== "");
}

async function arcscanJson(params, attempt = 1) {
  const qs = new URLSearchParams(params);
  await sleep(REQUEST_DELAY_MS);
  try {
    const resp = await fetch(`${ARCSCAN_API}?${qs.toString()}`);
    const data = await resp.json().catch(() => ({}));
    if (data?.message && String(data.message).toLowerCase().includes("rate limit")) {
      console.warn("  Arcscan rate limit — waiting 3s…");
      await sleep(3000);
      return arcscanJson(params, attempt);
    }
    return data;
  } catch (err) {
    if (attempt >= 8) throw err;
    const wait = Math.min(30_000, 2000 * attempt);
    console.warn(`  Arcscan fetch failed (attempt ${attempt}) — retry in ${wait / 1000}s…`);
    await sleep(wait);
    return arcscanJson(params, attempt + 1);
  }
}

async function latestBlockNumber() {
  const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    return await provider.getBlockNumber();
  } catch {
    const data = await arcscanJson({ module: "block", action: "eth_block_number" });
    return Number.parseInt(String(data.result || "0x0"), 16);
  }
}

async function fetchLogsRange(address, topic0, fromBlock, toBlock) {
  const data = await arcscanJson({
    module: "logs",
    action: "getLogs",
    address,
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    topic0,
  });
  if (data.status !== "1" || !Array.isArray(data.result)) return [];
  return data.result;
}

async function fetchAllLogs(address, topic0, fromBlock, toBlock, label = "") {
  const out = [];

  async function walk(start, end) {
    const logs = await fetchLogsRange(address, topic0, start, end);
    if (logs.length >= 1000 && start < end) {
      const mid = Math.floor((start + end) / 2);
      if (mid <= start) {
        out.push(...logs);
        return;
      }
      await walk(start, mid);
      await walk(mid + 1, end);
      return;
    }
    out.push(...logs);
  }

  const CHUNK = 250_000;
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, toBlock);
    await walk(start, end);
    if (label) process.stdout.write(`\r  ${label}: ${out.length} logs`);
  }
  if (label) process.stdout.write("\n");
  return out;
}

/** Stream Arcscan txlist pages without holding the full history in memory. */
async function* streamTxlist(address, fromBlock, toBlock) {
  let cursor = fromBlock;
  let total = 0;

  while (cursor <= toBlock) {
    const data = await arcscanJson({
      module: "account",
      action: "txlist",
      address,
      startblock: String(cursor),
      endblock: String(toBlock),
      sort: "asc",
    });

    if (data.status !== "1" || !Array.isArray(data.result) || !data.result.length) break;

    for (const tx of data.result) {
      total += 1;
      yield tx;
    }

    const lastBlock = Number(data.result[data.result.length - 1].blockNumber);
    cursor = lastBlock + 1;
    process.stdout.write(`\r  txs ${address.slice(0, 8)}… ${total}`);
  }

  process.stdout.write("\n");
}

async function writeCsvStream(filename, header, rowGenerator) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, filename);
  const stream = createWriteStream(path, { encoding: "utf8" });
  stream.write(csvLine(header));

  let count = 0;
  for await (const cols of rowGenerator) {
    stream.write(csvLine(cols));
    count += 1;
    if (count % 10000 === 0) process.stdout.write(`\r  wrote ${count} rows…`);
  }

  stream.end();
  await finished(stream);
  process.stdout.write(`\r  wrote ${count} rows → ${path}\n`);
  return count;
}

function parseSwappedLog(log, poolAddress, poolId) {
  let parsed;
  try {
    parsed = swapLogIface.parseLog({
      topics: cleanTopics(log.topics),
      data: log.data,
    });
  } catch {
    return null;
  }
  if (parsed?.name !== "Swapped") return null;

  const i = parsed.args.i;
  const j = parsed.args.j;
  const dx = parsed.args.dx;
  const dy = parsed.args.dy;
  const inSym = symbolForIndex(i);
  const outSym = symbolForIndex(j);

  return [
    logIsoTime(log),
    parseBlockNumber(log.blockNumber),
    log.transactionHash,
    poolAddress,
    poolId,
    String(parsed.args.user).toLowerCase(),
    Number(i),
    inSym,
    Number(j),
    outSym,
    formatTokenAmount(inSym, dx),
    formatTokenAmount(outSym, dy),
    usdVolumeFromSwapInput(i, dx),
  ];
}

async function exportSwaps(latestBlock) {
  console.log("\n[1/3] Exporting swaps…");
  const header = [
    "block_time",
    "block_number",
    "tx_hash",
    "pool_address",
    "pool_id",
    "user_address",
    "token_in_index",
    "token_in_symbol",
    "token_out_index",
    "token_out_symbol",
    "amount_in",
    "amount_out",
    "usd_volume",
  ];

  async function* rows() {
    console.log(`  v2 logs: ${V2_SWAP_POOL_ADDRESS}`);
    const v2Logs = await fetchAllLogs(
      V2_SWAP_POOL_ADDRESS,
      SWAPPED_TOPIC,
      SWAP_POOL_V2_FROM_BLOCK || 47_000_000,
      latestBlock,
      "swaps/v2"
    );
    for (const log of v2Logs) {
      const row = parseSwappedLog(log, V2_SWAP_POOL_ADDRESS, "v2");
      if (row) yield row;
    }

    if (!INCLUDE_LEGACY_SWAPS) return;

    console.log(`  legacy txs: ${LEGACY_SWAP_POOL_ADDRESS}`);
    for await (const tx of streamTxlist(LEGACY_SWAP_POOL_ADDRESS, 0, latestBlock)) {
      if (tx.isError === "1" || !tx.input?.startsWith(SWAP_SELECTOR) || !tx.from) continue;
      let decoded;
      try {
        decoded = swapTxIface.parseTransaction({ data: tx.input });
      } catch {
        continue;
      }
      if (decoded?.name !== "swap") continue;

      const i = decoded.args[0];
      const j = decoded.args[1];
      const dx = decoded.args[2];
      const inSym = symbolForIndex(i);
      const outSym = symbolForIndex(j);
      const blockTime =
        tx.timeStamp && Number(tx.timeStamp) > 0
          ? new Date(Number(tx.timeStamp) * 1000).toISOString()
          : "";

      yield [
        blockTime,
        Number(tx.blockNumber),
        tx.hash,
        LEGACY_SWAP_POOL_ADDRESS,
        "legacy",
        String(tx.from).toLowerCase(),
        Number(i),
        inSym,
        Number(j),
        outSym,
        formatTokenAmount(inSym, dx),
        "",
        usdVolumeFromSwapInput(i, dx),
      ];
    }
  }

  return writeCsvStream("swaparc_swaps.csv", header, rows());
}

async function exportPools(latestBlock) {
  console.log("\n[2/3] Exporting V2 liquidity events…");
  const header = [
    "block_time",
    "block_number",
    "tx_hash",
    "pool_address",
    "pool_name",
    "event_type",
    "detail",
  ];

  async function* rows() {
    const liqLogs = await fetchAllLogs(
      V2_SWAP_POOL_ADDRESS,
      LIQUIDITY_ADDED_TOPIC,
      SWAP_POOL_V2_FROM_BLOCK || 47_000_000,
      latestBlock,
      "pools/v2"
    );

    for (const log of liqLogs) {
      let parsed;
      try {
        parsed = swapLogIface.parseLog({
          topics: cleanTopics(log.topics),
          data: log.data,
        });
      } catch {
        continue;
      }
      if (parsed?.name !== "LiquidityAdded") continue;
      const amounts = parsed.args.amounts.map((a, idx) => {
        const sym = symbolForIndex(idx);
        return `${sym}:${formatTokenAmount(sym, a)}`;
      });
      yield [
        logIsoTime(log),
        parseBlockNumber(log.blockNumber),
        log.transactionHash,
        V2_SWAP_POOL_ADDRESS,
        "swap-pool-v2",
        "LiquidityAdded",
        amounts.join(" | "),
      ];
    }
  }

  return writeCsvStream("swaparc_pools.csv", header, rows());
}

async function exportPrivpay(latestBlock) {
  console.log("\n[3/3] Exporting PrivPay…");
  const header = [
    "block_time",
    "block_number",
    "tx_hash",
    "pool_address",
    "token_symbol",
    "event_type",
    "amount",
    "indexed_id",
    "user_or_recipient",
  ];

  if (!PRIVPAY_POOLS.length) {
    console.warn("  no PrivPay pool addresses in .env — writing header only");
    await writeFile(join(OUT_DIR, "swaparc_privpay.csv"), csvLine(header), "utf8");
    return 0;
  }

  async function* rows() {
    for (const pool of PRIVPAY_POOLS) {
      console.log(`  ${pool.token}: ${pool.address}`);
      for (const topic0 of [DEPOSITED_TOPIC, WITHDRAWN_TOPIC]) {
        const logs = await fetchAllLogs(
          pool.address,
          topic0,
          PRIVPAY_FROM_BLOCK,
          latestBlock,
          `privpay/${pool.token}`
        );

        for (const log of logs) {
          let parsed;
          try {
            parsed = privLogIface.parseLog({
              topics: cleanTopics(log.topics),
              data: log.data,
            });
          } catch {
            continue;
          }

          if (parsed.name === "Deposited") {
            yield [
              logIsoTime(log),
              parseBlockNumber(log.blockNumber),
              log.transactionHash,
              pool.address,
              pool.token,
              "deposit",
              formatTokenAmount(pool.token, parsed.args.amount),
              parsed.args.commitment,
              "",
            ];
          } else if (parsed.name === "Withdrawn") {
            yield [
              logIsoTime(log),
              parseBlockNumber(log.blockNumber),
              log.transactionHash,
              pool.address,
              pool.token,
              "withdraw",
              formatTokenAmount(pool.token, parsed.args.amount),
              parsed.args.nullifierHash,
              String(parsed.args.recipient).toLowerCase(),
            ];
          }
        }
      }
    }
  }

  return writeCsvStream("swaparc_privpay.csv", header, rows());
}

async function main() {
  console.log("SwapArc → Dune CSV export (Arcscan, local only)");
  console.log(`Output folder: ${OUT_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });

  const latestBlock = await latestBlockNumber();
  console.log(`Latest Arc block: ${latestBlock}`);

  const swapRows = await exportSwaps(latestBlock);
  const poolRows = await exportPools(latestBlock);
  const privpayRows = await exportPrivpay(latestBlock);

  const summary = {
    exportedAt: new Date().toISOString(),
    latestBlock,
    swapRows,
    poolRows,
    privpayRows,
    files: ["swaparc_swaps.csv", "swaparc_pools.csv", "swaparc_privpay.csv"],
    folder: OUT_DIR,
  };

  await writeFile(join(OUT_DIR, "README.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("\n========================================");
  console.log("Done!");
  console.log(`  Swaps:   ${swapRows}`);
  console.log(`  Pools:   ${poolRows}`);
  console.log(`  PrivPay: ${privpayRows}`);
  console.log(`  Folder:  ${OUT_DIR}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("exportDuneCsv failed:", err);
  process.exit(1);
});
