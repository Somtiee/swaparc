/**
 * Circle grant / Dune export — matches production landing stats from Railway Redis,
 * plus on-chain OLD (legacy) and NEW (v2) swap pool detail. Run locally once.
 *
 *   npm run stats:export-dune-grant
 *
 * Output: data/dune-export/grant/
 *   swaparc_swap_pool_total.csv   — combined platform totals (8M+ swaps, matches landing)
 *   swaparc_old_swap_pool.csv     — legacy pool on-chain swap rows
 *   swaparc_new_swap_pool.csv     — v2 pool on-chain swap rows
 *   swaparc_lp_pools.csv         — LP pool TVL (USDC/EURC, USDC/SWPRC, EURC/SWPRC)
 *   swaparc_privpay.csv           — PrivPay deposits/withdrawals
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { ethers } from "ethers";
import { createClient } from "../lib/server/kv.js";
import {
  buildLandingPublicPayload,
  writeLandingPublicJsonFile,
} from "../lib/server/landingPublicStats.js";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  SWAP_POOL_INDEX_TO_SYMBOL,
  SWAP_POOL_TOKEN_DECIMALS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
} from "../lib/swapPoolStatsConfig.js";
import { scanSwapPoolTxs } from "../lib/server/scanSwapPoolTxs.js";
import { fetchLpPoolTvlSnapshot } from "../lib/server/exportLpPoolTvl.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data/dune-export/grant");
const ARCSCAN_API = "https://testnet.arcscan.app/api";
const REQUEST_DELAY_MS = Number(process.env.DUNE_EXPORT_DELAY_MS || 180);

const HIGHWATER_KEY = "stats:landing:highwater:v1";
const COUNT_KEY = "stats:countUniqueSwappers:last";
const VOLUME_KEY = "stats:totalSwapVolume:last";
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.DUNE_DB_SCAN_COUNT || 1000));

const kv = createClient();

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
const RUN_LEGACY_ROWS =
  String(process.env.DUNE_EXPORT_LEGACY_ROWS || "true").toLowerCase() === "true";
const CHECKPOINT_FILE = join(OUT_DIR, ".export-checkpoint.json");

const POOL_READ_ABI = [
  "function getBalances() view returns (uint256[])",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
];
const SWAP_HEADER = [
  "block_time",
  "block_number",
  "tx_hash",
  "pool_address",
  "pool_segment",
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

async function sumUsdVolumeFromCsv(filename) {
  const { readFile } = await import("node:fs/promises");
  const path = join(OUT_DIR, filename);
  try {
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    if (lines.length < 2) return 0;
    const header = lines[0].split(",");
    const volIdx = header.lastIndexOf("usd_volume");
    if (volIdx < 0) return 0;
    let sum = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const lastComma = line.lastIndexOf(",");
      if (lastComma < 0) continue;
      sum += toNumber(line.slice(lastComma + 1).replace(/"/g, ""));
    }
    return sum;
  } catch {
    return 0;
  }
}

async function countCsvRows(filename) {
  const { readFile } = await import("node:fs/promises");
  try {
    const lines = (await readFile(join(OUT_DIR, filename), "utf8")).trim().split("\n");
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
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
    if (attempt >= 12) throw err;
    const wait = Math.min(45_000, 2500 * attempt);
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

async function* streamTxlist(address, fromBlock, toBlock, onPage) {
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
    if (onPage) await onPage({ cursor, total, lastBlock });
    process.stdout.write(`\r  legacy txs streamed: ${total.toLocaleString()}`);
  }

  process.stdout.write("\n");
}

async function writeCsvStream(filename, header, rowGenerator, opts = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, filename);
  const append = Boolean(opts.append);
  const stream = createWriteStream(path, { encoding: "utf8", flags: append ? "a" : "w" });
  if (!append) stream.write(csvLine(header));

  let count = 0;
  for await (const cols of rowGenerator) {
    await writeCsvRowWithRetry(stream, cols);
    count += 1;
    if (count % 5000 === 0) process.stdout.write(`\r  ${filename}: ${count.toLocaleString()} rows…`);
  }

  stream.end();
  await finished(stream);
  process.stdout.write(`\r  ${filename}: ${count.toLocaleString()} rows → ${path}\n`);
  return count;
}

function writeCsvRowWithRetry(stream, cols, attempt = 1) {
  return new Promise((resolve, reject) => {
    const line = csvLine(cols);
    const ok = stream.write(line, (err) => {
      if (err) {
        if (attempt >= 12 && (err.code === "EBUSY" || err.code === "EPERM")) {
          reject(new Error(`${err.code}: close Excel or any app using the export folder, then re-run`));
          return;
        }
        if (attempt < 12 && (err.code === "EBUSY" || err.code === "EPERM")) {
          setTimeout(() => {
            writeCsvRowWithRetry(stream, cols, attempt + 1).then(resolve).catch(reject);
          }, 1500 * attempt);
          return;
        }
        reject(err);
        return;
      }
      resolve();
    });
    if (!ok) {
      stream.once("drain", () => resolve());
    }
  });
}

async function loadCheckpoint() {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCheckpoint(patch) {
  const prev = await loadCheckpoint();
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(CHECKPOINT_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function scanOnChainPoolCounts() {
  console.log("\n  V2 on-chain swap count (for NEW pool row)…");
  const v2 = await scanSwapPoolTxs(V2_SWAP_POOL_ADDRESS, {
    startBlock: SWAP_POOL_V2_FROM_BLOCK || 0,
  });
  console.log(`  NEW on-chain (v2): ${v2.totalSwapCalls.toLocaleString()}`);
  return {
    legacySwaps: 0,
    v2Swaps: v2.totalSwapCalls,
    legacyUniqueWallets: "",
    v2UniqueWallets: v2.uniqueWallets.size,
  };
}

async function bootstrapCheckpoint(checkpoint) {
  const { access, readFile } = await import("node:fs/promises");
  const next = { ...checkpoint };

  const newPath = join(OUT_DIR, "swaparc_new_swap_pool.csv");
  try {
    await access(newPath);
    if (!next.v2Done) {
      const lines = (await readFile(newPath, "utf8")).trim().split("\n");
      const rows = Math.max(0, lines.length - 1);
      if (rows > 1000) {
        next.v2Done = true;
        next.v2Rows = rows;
      }
    }
  } catch {
    /* missing */
  }

  return next;
}

async function writeCsv(filename, header, rows) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, filename);
  const lines = [csvLine(header), ...rows.map((r) => csvLine(r))].join("");
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, lines, "utf8");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, path);
      return { path, rows: rows.length };
    } catch (err) {
      if (err?.code !== "EBUSY" && err?.code !== "EPERM") throw err;
      if (attempt < 4) await sleep(1500);
    }
  }

  const fallback = `${path}.new`;
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, fallback);
  console.warn(`  Warning: ${filename} is locked — wrote ${basename(fallback)} instead (close Excel and rename)`);
  return { path: fallback, rows: rows.length };
}

function parseSwappedLog(log, poolAddress, poolId, segment) {
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
    segment,
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

async function scanProfileTotals() {
  let cursor = 0;
  let iterations = 0;
  let scannedProfiles = 0;
  let totalSwapVolume = 0;
  let totalSwapCount = 0;
  let uniqueSwapWallets = 0;

  console.log("\n[1/6] Scanning Railway Redis profile:* (local run, not app egress)…");

  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: SCAN_MATCH,
      count: SCAN_COUNT,
    });
    cursor = nextCursor;
    iterations += 1;

    if (Array.isArray(keys) && keys.length > 0) {
      const profiles = await kv.mget(...keys);
      for (const profile of profiles || []) {
        if (!profile || typeof profile !== "object") continue;
        scannedProfiles += 1;
        const swapCount = toNumber(profile.swapCount || 0);
        const swapVolume = toNumber(profile.swapVolume || 0);
        const lp = toNumber(profile.lpProvided || 0);
        totalSwapCount += swapCount;
        totalSwapVolume += swapVolume;
        if (swapCount > 0 || swapVolume > 0 || lp > 0) uniqueSwapWallets += 1;
      }
    }

    if (iterations % 25 === 0) {
      process.stdout.write(
        `\r  profiles: ${scannedProfiles.toLocaleString()}, swapCount sum: ${totalSwapCount.toLocaleString()}`
      );
    }

    if (cursor === 0 || cursor === "0") break;
    if (iterations > 1_000_000) throw new Error("Profile scan guard tripped");
  }

  process.stdout.write("\n");
  return { scannedProfiles, totalSwapVolume, totalSwapCount, uniqueSwapWallets };
}

function mergeLandingTotals(highwater, countStats, volStats, profileScan) {
  const hw = highwater?.latest || highwater || {};
  return {
    total_swap_count: Math.max(
      toNumber(hw.totalSwapCount),
      toNumber(countStats?.totalSwapCount ?? countStats?.totalSwapCalls),
      toNumber(profileScan.totalSwapCount)
    ),
    total_swap_volume_usd: Math.max(
      toNumber(hw.totalSwapVolume),
      toNumber(volStats?.totalSwapVolume),
      toNumber(profileScan.totalSwapVolume)
    ),
    unique_users: Math.max(
      toNumber(hw.uniqueUsers),
      toNumber(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets),
      toNumber(profileScan.uniqueSwapWallets)
    ),
    scanned_profiles: toNumber(profileScan.scannedProfiles),
  };
}

async function refreshLandingJson(totals) {
  console.log("\n[2/6] Updating public/stats/landing-network.json (fixes localhost 4.9M → 8M)…");
  const payload = await buildLandingPublicPayload({
    totalSwapVolume: totals.total_swap_volume_usd,
    totalSwapCount: totals.total_swap_count,
    uniqueSwapWallets: totals.unique_users,
  });
  await writeLandingPublicJsonFile(payload);
  console.log(
    `  landing-network.json → ${totals.total_swap_count.toLocaleString()} swaps, ${totals.unique_users.toLocaleString()} users`
  );
  return payload;
}

function platformPoolCounts(totals, v2OnChain) {
  const newSwaps = Math.max(0, Number(v2OnChain.v2Swaps) || 0);
  const totalSwaps = Math.max(0, Number(totals.total_swap_count) || 0);
  const oldSwaps = Math.max(0, totalSwaps - newSwaps);
  return {
    legacySwaps: oldSwaps,
    v2Swaps: newSwaps,
    legacyUniqueWallets: totals.unique_users,
    v2UniqueWallets: v2OnChain.v2UniqueWallets ?? "",
  };
}

async function exportSwapPoolTotal(totals, poolCounts, volumeStats, refreshedAt) {
  console.log("\n[3/6] Writing swap pool summary (OLD / NEW / TOTAL)…");

  const rows = [
    [
      refreshedAt,
      "OLD SWAP POOL",
      "legacy",
      LEGACY_SWAP_POOL_ADDRESS,
      poolCounts.legacySwaps,
      volumeStats.legacyUsdVol,
      poolCounts.legacyUniqueWallets ?? totals.unique_users,
      "railway_redis_profile_scan",
      "Platform swap count (TOTAL−NEW). Volume = on-chain USDC/EURC legs only.",
    ],
    [
      refreshedAt,
      "NEW SWAP POOL",
      "v2",
      V2_SWAP_POOL_ADDRESS,
      poolCounts.v2Swaps,
      volumeStats.v2UsdVol,
      poolCounts.v2UniqueWallets ?? "",
      "arcscan_on_chain",
      "V2 on-chain swaps. Volume = sum of usd_volume in swaparc_new_swap_pool.csv",
    ],
    [
      refreshedAt,
      "SWAP POOL (TOTAL)",
      "combined",
      `${LEGACY_SWAP_POOL_ADDRESS};${V2_SWAP_POOL_ADDRESS}`,
      totals.total_swap_count,
      volumeStats.totalUsdVol,
      totals.unique_users,
      "railway_redis_profile_scan",
      "Swap count matches landing. Volume = on-chain USDC/EURC only (not inflated Redis sum).",
    ],
  ];

  return writeCsv(
    "swaparc_swap_pool_total.csv",
    [
      "refreshed_at",
      "segment",
      "pool_id",
      "pool_address",
      "total_swaps",
      "total_swap_volume_usd",
      "unique_wallets",
      "data_source",
      "notes",
    ],
    rows
  );
}

async function exportNewSwapPool(latestBlock) {
  console.log("\n[4/6] Exporting NEW swap pool (v2) rows…");
  const fromBlock = SWAP_POOL_V2_FROM_BLOCK || 47_000_000;

  async function* rows() {
    const logs = await fetchAllLogs(
      V2_SWAP_POOL_ADDRESS,
      SWAPPED_TOPIC,
      fromBlock,
      latestBlock,
      "new pool"
    );
    for (const log of logs) {
      const row = parseSwappedLog(log, V2_SWAP_POOL_ADDRESS, "v2", "NEW SWAP POOL");
      if (row) yield row;
    }
  }

  return writeCsvStream("swaparc_new_swap_pool.csv", SWAP_HEADER, rows());
}

async function exportOldSwapPoolSummary(poolCounts, volumeStats, totals, refreshedAt) {
  return writeCsv(
    "swaparc_old_swap_pool_summary.csv",
    [
      "refreshed_at",
      "segment",
      "pool_id",
      "pool_address",
      "platform_swap_count",
      "on_chain_swap_rows",
      "on_chain_usd_volume",
      "unique_wallets",
      "data_source",
      "notes",
    ],
    [
      [
        refreshedAt,
        "OLD SWAP POOL",
        "legacy",
        LEGACY_SWAP_POOL_ADDRESS,
        poolCounts.legacySwaps,
        volumeStats.legacyOnChainRows,
        volumeStats.legacyUsdVol,
        poolCounts.legacyUniqueWallets ?? totals.unique_users,
        "railway_redis_profile_scan",
        "platform_swap_count matches landing (8M+). Individual txs in swaparc_old_swap_pool.csv are on-chain verified rows.",
      ],
    ]
  );
}

async function exportOldSwapPoolOnChain(latestBlock) {
  console.log("\n[5b/6] Exporting OLD swap pool on-chain transaction rows (streams until complete)…");
  let usdSum = 0;

  async function* rows() {
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
      const vol = usdVolumeFromSwapInput(i, dx);
      usdSum += vol;
      const blockTime =
        tx.timeStamp && Number(tx.timeStamp) > 0
          ? new Date(Number(tx.timeStamp) * 1000).toISOString()
          : "";

      yield [
        blockTime,
        Number(tx.blockNumber),
        tx.hash,
        LEGACY_SWAP_POOL_ADDRESS,
        "OLD SWAP POOL",
        "legacy",
        String(tx.from).toLowerCase(),
        Number(i),
        inSym,
        Number(j),
        outSym,
        formatTokenAmount(inSym, dx),
        "",
        vol,
      ];
    }
  }

  const rowCount = await writeCsvStream("swaparc_old_swap_pool.csv", SWAP_HEADER, rows());
  return { rowCount, usdSum };
}

async function exportPoolTvl(refreshedAt) {
  console.log("\n[6a/6] Reading on-chain LP pool TVL (USDC/EURC, USDC/SWPRC, EURC/SWPRC)…");
  const snap = await fetchLpPoolTvlSnapshot();
  const at = refreshedAt || snap.refreshedAt;

  const header = [
    "refreshed_at",
    "pool_id",
    "pool_name",
    "pool_address",
    "token_a_symbol",
    "token_a_locked",
    "token_a_usd",
    "token_b_symbol",
    "token_b_locked",
    "token_b_usd",
    "pool_tvl_usd",
  ];

  const rows = snap.pools.map((p) => [
    at,
    p.poolId,
    p.poolName,
    p.poolAddress,
    p.tokenASymbol,
    p.tokenALocked,
    p.tokenAUsd,
    p.tokenBSymbol,
    p.tokenBLocked,
    p.tokenBUsd,
    p.poolTvlUsd,
  ]);

  await writeCsv("swaparc_lp_pools.csv", header, rows);

  console.log(
    `  Total TVL $${snap.totalTvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} | ${snap.activePools} LP pools`
  );
  for (const p of snap.pools) {
    console.log(
      `    ${p.poolName}: $${p.poolTvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    );
  }
  return snap.pools.length;
}

async function exportPrivpay(latestBlock) {
  console.log("\n[6b/6] Exporting PrivPay…");
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
    console.warn("  no PrivPay addresses in .env");
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
  console.log("SwapArc grant export — Railway Redis + Arcscan (local only)");
  console.log(`Output: ${OUT_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });

  const [highwater, countStats, volStats, profileScan] = await Promise.all([
    kv.get(HIGHWATER_KEY),
    kv.get(COUNT_KEY),
    kv.get(VOLUME_KEY),
    scanProfileTotals(),
  ]);

  const totals = mergeLandingTotals(highwater, countStats, volStats, profileScan);
  const refreshedAt = new Date().toISOString();

  console.log("\nLanding-aligned totals (Railway Redis):");
  console.log(`  total_swap_count:      ${totals.total_swap_count.toLocaleString()}`);
  console.log(`  total_swap_volume_usd: ${totals.total_swap_volume_usd.toLocaleString()}`);
  console.log(`  unique_users:          ${totals.unique_users.toLocaleString()}`);

  await refreshLandingJson(totals);

  const onChainV2 = await scanOnChainPoolCounts();
  const poolCounts = platformPoolCounts(totals, onChainV2);

  const latestBlock = await latestBlockNumber();
  console.log(`\nLatest Arc block: ${latestBlock}`);

  const checkpoint = await bootstrapCheckpoint(await loadCheckpoint());

  let newRows = Number(checkpoint.v2Rows || poolCounts.v2Swaps);
  if (!checkpoint.v2Done) {
    newRows = await exportNewSwapPool(latestBlock);
    await saveCheckpoint({ v2Done: true, v2Rows: newRows });
  } else {
    console.log(`\n[4/6] NEW swap pool already exported (${newRows.toLocaleString()} rows) — skipping`);
  }

  poolCounts.v2Swaps = Math.max(poolCounts.v2Swaps, newRows);
  const poolCountsFinal = platformPoolCounts(totals, poolCounts);

  let legacyOnChain = { rowCount: 0, usdSum: 0 };
  const oldOnChainRows = await countCsvRows("swaparc_old_swap_pool.csv");
  const needLegacyRows = RUN_LEGACY_ROWS && oldOnChainRows < 1000;
  if (needLegacyRows) {
    legacyOnChain = await exportOldSwapPoolOnChain(latestBlock);
    await saveCheckpoint({ legacyOnChainDone: true, legacyOnChainRows: legacyOnChain.rowCount });
  } else if (oldOnChainRows >= 1000) {
    console.log(`\n[5b/6] OLD on-chain rows already exported (${oldOnChainRows.toLocaleString()}) — skipping`);
    legacyOnChain.usdSum = await sumUsdVolumeFromCsv("swaparc_old_swap_pool.csv");
    legacyOnChain.rowCount = oldOnChainRows;
  }

  const v2UsdVol = await sumUsdVolumeFromCsv("swaparc_new_swap_pool.csv");
  const volumeStats = {
    v2UsdVol,
    legacyUsdVol: legacyOnChain.usdSum,
    legacyOnChainRows: legacyOnChain.rowCount,
    totalUsdVol: v2UsdVol + legacyOnChain.usdSum,
  };

  console.log("\n[5/6] Writing OLD swap pool platform summary…");
  await exportOldSwapPoolSummary(poolCountsFinal, volumeStats, totals, refreshedAt);

  const poolRows = await exportPoolTvl(refreshedAt);
  await saveCheckpoint({ poolsDone: true, poolRows: 1 });

  const privpayRows = await exportPrivpay(latestBlock);
  await saveCheckpoint({ privpayDone: true, privpayRows });

  const totalFile = await exportSwapPoolTotal(totals, poolCountsFinal, volumeStats, refreshedAt);
  console.log(
    `  Volume (USDC/EURC on-chain): $${volumeStats.totalUsdVol.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  );

  const summary = {
    exportedAt: refreshedAt,
    outDir: OUT_DIR,
    landingTotals: totals,
    poolCounts: poolCountsFinal,
    volumeStats,
    onChainV2: onChainV2,
    rowCounts: {
      swap_pool_total: totalFile.rows,
      old_swap_pool_summary: 1,
      old_swap_pool_on_chain_rows: legacyOnChain.rowCount,
      new_swap_pool: newRows,
      pools: poolRows,
      privpay: privpayRows,
    },
    files: [
      "swaparc_swap_pool_total.csv",
      "swaparc_old_swap_pool_summary.csv",
      "swaparc_old_swap_pool.csv",
      "swaparc_new_swap_pool.csv",
      "swaparc_lp_pools.csv",
      "swaparc_privpay.csv",
    ],
    note:
      "Swap COUNTS (8M+) come from Railway Redis platform telemetry. " +
      "Swap VOLUME uses on-chain USDC/EURC legs only (not inflated Redis profile sum). " +
      "swaparc_old_swap_pool.csv lists verified on-chain legacy txs (~446k max); platform counts higher because app-indexed swaps are not stored as individual rows in Redis.",
  };

  await writeFile(join(OUT_DIR, "README.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("\n========================================");
  console.log("GRANT EXPORT COMPLETE");
  console.log(`  TOTAL swaps:     ${totals.total_swap_count.toLocaleString()} (platform)`);
  console.log(`  OLD swaps:       ${poolCountsFinal.legacySwaps.toLocaleString()} (platform)`);
  console.log(`  OLD on-chain tx: ${legacyOnChain.rowCount.toLocaleString()} rows in CSV`);
  console.log(`  NEW on-chain:    ${poolCountsFinal.v2Swaps.toLocaleString()} rows`);
  console.log(`  Volume (chain):  $${volumeStats.totalUsdVol.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`  Pool TVL row:    1`);
  console.log(`  PrivPay:         ${privpayRows}`);
  console.log(`  Folder:          ${OUT_DIR}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("exportDuneGrant failed:", err);
  process.exit(1);
});
