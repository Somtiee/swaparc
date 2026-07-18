/**
 * Rebuild profile.swapVolume from on-chain swaps (USDC-equivalent via pool quotes).
 * Run locally — one Redis pass, no app egress spike. Does not touch swapCount.
 *
 * Fast sharded flow (recommended for 8M+ legacy swaps):
 *   1. npm run stats:backfill-dump-swaps
 *   2. npm run stats:backfill-quote-shards -- 30        (or launchVolumeQuoteShards.ps1)
 *   3. npm run stats:backfill-merge-shards
 *   4. npm run stats:backfill-apply-volume
 *
 * Single-process (slow for legacy):
 *   npm run stats:backfill-swap-volume
 *   npm run stats:backfill-swap-volume -- --dry-run
 *   npm run stats:backfill-swap-volume -- --apply-only
 */
import "dotenv/config";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, unlink, readdir, appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { Redis } from "ioredis";
import { createClient } from "../lib/server/kv.js";
import { writeLandingPublicJsonFile } from "../lib/server/landingPublicStats.js";
import {
  LEGACY_SWAP_POOL_ADDRESS,
  SWAP_POOL_V2_FROM_BLOCK,
  V2_SWAP_POOL_ADDRESS,
  createPoolUsdcQuoter,
  usdVolumeUsdcEquivalent,
  scaleWalletVolumesToPlatform,
  asyncPool,
} from "../lib/server/onChainSwapVolume.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCSCAN_API = "https://testnet.arcscan.app/api";
const REQUEST_DELAY_MS = Number(process.env.DUNE_EXPORT_DELAY_MS || 180);
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.DUNE_DB_SCAN_COUNT || 1000));

const HIGHWATER_KEY = "stats:landing:highwater:v1";
const COUNT_KEY = "stats:countUniqueSwappers:last";
const VOLUME_KEY = "stats:totalSwapVolume:last";
const LEADERBOARD_VOLUME_KEY = "leaderboard:swapVolume";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_LEGACY = process.argv.includes("--skip-legacy");
const SKIP_V2 = process.argv.includes("--skip-v2");
const APPLY_ONLY = process.argv.includes("--apply-only");
/** Re-apply profile.swapVolume + leaderboard only (no landing/highwater writes). */
const PROFILES_ONLY = process.argv.includes("--profiles-only");
const DUMP_ONLY = process.argv.includes("--dump-only");
const QUOTE_ONLY = process.argv.includes("--quote-only");
const MERGE_SHARDS = process.argv.includes("--merge-shards");
const CHECKPOINT_FILE = join(ROOT, "data/stats/volume-backfill-checkpoint.json");
const MANIFEST_FILE = join(ROOT, "data/stats/volume-backfill-manifest.json");
const LEGACY_SWAPS_FILE = join(ROOT, "data/stats/legacy-swaps.ndjson");
const V2_SWAPS_FILE = join(ROOT, "data/stats/v2-swaps.ndjson");
const SHARD_DIR = join(ROOT, "data/stats/volume-shards");
const CHECKPOINT_VERSION = 2; // v2 = USDC-equivalent (get_dy for all non-USDC legs)
const QUOTE_CONCURRENCY = Math.max(1, Number(process.env.VOLUME_QUOTE_CONCURRENCY || 12));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function parseShardArg() {
  const raw = argValue("--shard");
  if (!raw) return null;
  const parts = String(raw).split("/");
  if (parts.length !== 2) throw new Error("--shard requires N/M (e.g. 7/30)");
  const shardIndex = Number(parts[0]);
  const shardTotal = Number(parts[1]);
  if (
    !Number.isInteger(shardIndex) ||
    !Number.isInteger(shardTotal) ||
    shardIndex < 0 ||
    shardTotal < 1 ||
    shardIndex >= shardTotal
  ) {
    throw new Error(`Invalid --shard ${raw} (need 0 <= N < M)`);
  }
  return { shardIndex, shardTotal };
}

const SHARD = parseShardArg();
const SWAPS_FILE = argValue("--swaps-file") || LEGACY_SWAPS_FILE;
const SHARD_OUT = argValue("--out");
const MERGE_SHARDS_DIR = argValue("--merge-shards") || SHARD_DIR;

const kv = createClient();

const swapLogIface = new ethers.Interface([
  "event Swapped(address indexed user, uint256 i, uint256 j, uint256 dx, uint256 dy)",
]);
const swapTxIface = new ethers.Interface(["function swap(uint256 i,uint256 j,uint256 dx)"]);
const SWAPPED_TOPIC = swapLogIface.getEvent("Swapped").topicHash;
const SWAP_SELECTOR = swapTxIface.getFunction("swap").selector;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanTopics(topics) {
  return (topics || []).filter((t) => t != null && t !== "");
}

function parseBlockNumber(value) {
  const s = String(value || "0");
  if (s.startsWith("0x")) return Number.parseInt(s, 16);
  return Number(s);
}

async function arcscanJson(params, attempt = 1) {
  const qs = new URLSearchParams(params);
  await sleep(REQUEST_DELAY_MS);
  try {
    const resp = await fetch(`${ARCSCAN_API}?${qs.toString()}`);
    const data = await resp.json().catch(() => ({}));
    if (data?.message && String(data.message).toLowerCase().includes("rate limit")) {
      await sleep(3000);
      return arcscanJson(params, attempt);
    }
    return data;
  } catch (err) {
    if (attempt >= 12) throw err;
    await sleep(Math.min(45_000, 2500 * attempt));
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

async function* streamTxlist(address, fromBlock, toBlock) {
  let cursor = fromBlock;
  let total = 0;
  let page = 0;

  while (cursor <= toBlock) {
    page += 1;
    if (page === 1) {
      process.stdout.write("  Fetching legacy txs from Arcscan (first page)…");
    }

    let data = null;
    for (let attempt = 1; attempt <= 8; attempt++) {
      data = await arcscanJson({
        module: "account",
        action: "txlist",
        address,
        startblock: String(cursor),
        endblock: String(toBlock),
        sort: "asc",
      });
      if (data?.status === "1" && Array.isArray(data.result) && data.result.length > 0) break;
      process.stdout.write(`\r  Arcscan page ${page} retry ${attempt}/8…`);
      await sleep(Math.min(30_000, 2000 * attempt));
    }

    if (!data || data.status !== "1" || !Array.isArray(data.result) || !data.result.length) {
      console.warn(`\n  Arcscan stream ended at block cursor ${cursor} (page ${page}, total txs ${total})`);
      break;
    }

    for (const tx of data.result) {
      total += 1;
      yield tx;
    }

    const lastBlock = Number(data.result[data.result.length - 1].blockNumber);
    if (!Number.isFinite(lastBlock) || lastBlock < cursor) break;
    cursor = lastBlock + 1;
    process.stdout.write(`\r  legacy txs streamed: ${total.toLocaleString()} (page ${page})`);
  }

  process.stdout.write("\n");
}

function getRedisPipeline() {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url.startsWith("redis://") && !url.startsWith("rediss://")) return null;
  const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  return redis;
}

async function resolveProfileKeyForWallet(wallet, walletToProfile) {
  const lower = String(wallet).toLowerCase();
  if (walletToProfile.has(lower)) return walletToProfile.get(lower);

  const mapped = await kv.get(`wallet:${lower}`);
  const profileKey = mapped ? `profile:${mapped}` : `profile:${lower}`;
  walletToProfile.set(lower, profileKey);
  return profileKey;
}

async function preloadWalletMappings(wallets, walletToProfile) {
  const list = [...wallets];
  const redis = getRedisPipeline();
  const BATCH = 1000;

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    if (redis) {
      const pipe = redis.pipeline();
      for (const wallet of batch) pipe.get(`wallet:${wallet}`);
      const rows = await pipe.exec();
      for (let j = 0; j < batch.length; j++) {
        const lower = batch[j];
        const mapped = rows[j]?.[1];
        const profileKey =
          mapped && String(mapped).trim()
            ? `profile:${String(mapped).trim()}`
            : `profile:${lower}`;
        walletToProfile.set(lower, profileKey);
      }
    } else {
      for (const wallet of batch) {
        await resolveProfileKeyForWallet(wallet, walletToProfile);
      }
    }
    process.stdout.write(
      `\r  wallet mappings preloaded: ${Math.min(i + BATCH, list.length).toLocaleString()}/${list.length.toLocaleString()}`
    );
  }
  process.stdout.write("\n");
  if (redis) await redis.quit();
}

async function saveCheckpoint(walletVolumes, chainTotal, txCount) {
  await mkdir(join(ROOT, "data/stats"), { recursive: true });
  const payload = {
    version: CHECKPOINT_VERSION,
    formula: "usdc_equivalent_get_dy",
    savedAt: new Date().toISOString(),
    chainTotal,
    txCount,
    wallets: [...walletVolumes.entries()],
  };
  await writeFile(CHECKPOINT_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`  Checkpoint saved: ${CHECKPOINT_FILE}`);
}

async function loadCheckpoint() {
  const raw = await readFile(CHECKPOINT_FILE, "utf8");
  const data = parseJsonText(raw);
  if (Number(data.version) !== CHECKPOINT_VERSION) {
    throw new Error(
      `Checkpoint version ${data.version ?? "?"} is stale (need v${CHECKPOINT_VERSION} USDC-equivalent). Delete ${CHECKPOINT_FILE} and re-run full backfill.`
    );
  }
  const walletVolumes = new Map(
    (data.wallets || []).map(([wallet, vol]) => [String(wallet).toLowerCase(), toNumber(vol)])
  );
  return {
    walletVolumes,
    chainTotal: toNumber(data.chainTotal),
    txCount: toNumber(data.txCount),
  };
}

function serializeSwapRow(row) {
  return JSON.stringify({
    wallet: row.wallet,
    i: String(row.i),
    j: String(row.j),
    dx: String(row.dx),
    block: row.block,
    dy: row.dy != null ? String(row.dy) : null,
  });
}

function deserializeSwapRow(line) {
  const data = JSON.parse(line);
  return {
    wallet: String(data.wallet).toLowerCase(),
    i: BigInt(data.i),
    j: BigInt(data.j),
    dx: BigInt(data.dx),
    block: Number(data.block),
    dy: data.dy != null ? BigInt(data.dy) : null,
  };
}

function shardOutputPath(shardIndex, shardTotal) {
  const pad = String(shardIndex).padStart(2, "0");
  return join(SHARD_DIR, `shard-${pad}-of-${shardTotal}.json`);
}

function shardCheckpointPath(shardIndex, shardTotal) {
  const pad = String(shardIndex).padStart(2, "0");
  return join(SHARD_DIR, `shard-${pad}-of-${shardTotal}.checkpoint.json`);
}

async function saveManifest(manifest) {
  await mkdir(join(ROOT, "data/stats"), { recursive: true });
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`  Manifest saved: ${MANIFEST_FILE}`);
}

function stripUtf8Bom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function parseJsonText(raw) {
  return JSON.parse(stripUtf8Bom(raw));
}

async function loadManifest() {
  const raw = await readFile(MANIFEST_FILE, "utf8");
  return parseJsonText(raw);
}

async function dumpLegacySwapsToFile(seenTxHashes, latestBlock) {
  console.log("\n[dump] Legacy pool swaps → NDJSON…");
  await mkdir(join(ROOT, "data/stats"), { recursive: true });
  try {
    await unlink(LEGACY_SWAPS_FILE);
  } catch {
    /* fresh dump */
  }

  let count = 0;
  for await (const tx of streamTxlist(LEGACY_SWAP_POOL_ADDRESS, 0, latestBlock)) {
    if (tx.isError === "1" || !tx.input?.startsWith(SWAP_SELECTOR) || !tx.from) continue;
    const hash = String(tx.hash || "").toLowerCase();
    if (hash && seenTxHashes.has(hash)) continue;

    let decoded;
    try {
      decoded = swapTxIface.parseTransaction({ data: tx.input });
    } catch {
      continue;
    }
    if (decoded?.name !== "swap") continue;

    if (hash) seenTxHashes.add(hash);
    const row = {
      wallet: String(tx.from).toLowerCase(),
      i: decoded.args[0],
      j: decoded.args[1],
      dx: decoded.args[2],
      block: Number(tx.blockNumber),
    };
    await appendFile(LEGACY_SWAPS_FILE, `${serializeSwapRow(row)}\n`, "utf8");
    count += 1;
    if (count % 50_000 === 0) {
      process.stdout.write(`\r  legacy swaps written: ${count.toLocaleString()}`);
    }
  }
  process.stdout.write(`\r  legacy swaps written: ${count.toLocaleString()}\n`);
  return count;
}

async function dumpV2SwapsToFile(seenTxHashes, latestBlock) {
  console.log("\n[dump] V2 Swapped events → NDJSON…");
  const fromBlock = SWAP_POOL_V2_FROM_BLOCK || 47_000_000;
  const logs = await fetchAllLogs(
    V2_SWAP_POOL_ADDRESS,
    SWAPPED_TOPIC,
    fromBlock,
    latestBlock,
    "v2 Swapped"
  );

  try {
    await unlink(V2_SWAPS_FILE);
  } catch {
    /* fresh dump */
  }

  let count = 0;
  for (const log of logs) {
    const hash = String(log.transactionHash || "").toLowerCase();
    if (hash && seenTxHashes.has(hash)) continue;

    let parsed;
    try {
      parsed = swapLogIface.parseLog({
        topics: cleanTopics(log.topics),
        data: log.data,
      });
    } catch {
      continue;
    }
    if (parsed?.name !== "Swapped") continue;

    if (hash) seenTxHashes.add(hash);
    const row = {
      wallet: String(parsed.args.user).toLowerCase(),
      i: parsed.args.i,
      j: parsed.args.j,
      dx: parsed.args.dx,
      dy: parsed.args.dy,
      block: parseBlockNumber(log.blockNumber),
    };
    await appendFile(V2_SWAPS_FILE, `${serializeSwapRow(row)}\n`, "utf8");
    count += 1;
  }
  console.log(`  v2 swaps written: ${count.toLocaleString()}`);
  return count;
}

async function runDumpOnly() {
  const latestBlock = await latestBlockNumber();
  console.log(`Latest block: ${latestBlock}`);

  const seenTxHashes = new Set();
  let legacyCount = 0;
  let v2Count = 0;

  if (!SKIP_LEGACY) legacyCount = await dumpLegacySwapsToFile(seenTxHashes, latestBlock);
  if (!SKIP_V2) v2Count = await dumpV2SwapsToFile(seenTxHashes, latestBlock);

  const manifest = {
    version: CHECKPOINT_VERSION,
    formula: "usdc_equivalent_get_dy",
    dumpedAt: new Date().toISOString(),
    latestBlock,
    legacySwapCount: legacyCount,
    legacySwapsFile: LEGACY_SWAPS_FILE,
    v2SwapCount: v2Count,
    v2SwapsFile: V2_SWAPS_FILE,
    uniqueTxCount: seenTxHashes.size,
  };
  await saveManifest(manifest);

  console.log("\n========================================");
  console.log("DUMP COMPLETE");
  console.log(`  Legacy swaps: ${legacyCount.toLocaleString()} → ${LEGACY_SWAPS_FILE}`);
  console.log(`  V2 swaps:     ${v2Count.toLocaleString()} → ${V2_SWAPS_FILE}`);
  console.log(`  Unique txs:   ${seenTxHashes.size.toLocaleString()}`);
  console.log("\nNext: launch quote shards, then merge, then apply-only.");
  console.log("========================================");
}

async function loadShardCheckpoint(shardIndex, shardTotal) {
  try {
    const raw = await readFile(shardCheckpointPath(shardIndex, shardTotal), "utf8");
    const data = parseJsonText(raw);
    return {
      lastLineIndex: Number(data.lastLineIndex ?? -1),
      walletVolumes: new Map(
        (data.wallets || []).map(([w, v]) => [String(w).toLowerCase(), toNumber(v)])
      ),
      quoted: Number(data.quoted ?? 0),
      creditedVolume: toNumber(data.creditedVolume),
    };
  } catch {
    return {
      lastLineIndex: -1,
      walletVolumes: new Map(),
      quoted: 0,
      creditedVolume: 0,
    };
  }
}

async function saveShardCheckpoint(shardIndex, shardTotal, state) {
  await mkdir(SHARD_DIR, { recursive: true });
  const payload = {
    version: CHECKPOINT_VERSION,
    shardIndex,
    shardTotal,
    lastLineIndex: state.lastLineIndex,
    quoted: state.quoted,
    creditedVolume: state.creditedVolume,
    savedAt: new Date().toISOString(),
    wallets: [...state.walletVolumes.entries()],
  };
  await writeFile(
    shardCheckpointPath(shardIndex, shardTotal),
    `${JSON.stringify(payload)}\n`,
    "utf8"
  );
}

async function saveShardOutput(shardIndex, shardTotal, walletVolumes, stats, complete) {
  await mkdir(SHARD_DIR, { recursive: true });
  const outPath = SHARD_OUT || shardOutputPath(shardIndex, shardTotal);
  const payload = {
    version: CHECKPOINT_VERSION,
    formula: "usdc_equivalent_get_dy",
    shardIndex,
    shardTotal,
    complete,
    quoted: stats.quoted,
    creditedVolume: stats.creditedVolume,
    getDyCalls: stats.getDyCalls,
    getDyFailures: stats.getDyFailures,
    savedAt: new Date().toISOString(),
    wallets: [...walletVolumes.entries()],
  };
  await writeFile(outPath, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`  Shard output saved: ${outPath}`);
  return outPath;
}

async function quoteSwapRowsFromNdjson(swapsFile, poolAddress, shard, label) {
  const { shardIndex, shardTotal } = shard;
  const quoter = createPoolUsdcQuoter(poolAddress, { concurrency: QUOTE_CONCURRENCY });

  let state = await loadShardCheckpoint(shardIndex, shardTotal);
  const walletVolumes = state.walletVolumes;
  let creditedVolume = state.creditedVolume;
  let quoted = state.quoted;
  let lineIndex = -1;
  let batch = [];
  const batchSize = QUOTE_CONCURRENCY;

  console.log(
    `\n[quote] ${label} shard ${shardIndex}/${shardTotal} | concurrency ${QUOTE_CONCURRENCY} | file ${swapsFile}`
  );
  if (state.lastLineIndex >= 0) {
    console.log(
      `  Resuming from line ${(state.lastLineIndex + 1).toLocaleString()} (${quoted.toLocaleString()} already quoted)`
    );
  }

  const rl = createInterface({
    input: createReadStream(swapsFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  async function flushBatch(endLineIndex) {
    if (!batch.length) return;
    const results = await asyncPool(QUOTE_CONCURRENCY, batch, async (row) => {
      const vol = await usdVolumeUsdcEquivalent(
        row.i,
        row.j,
        row.dx,
        row.dy ?? null,
        quoter.quoteToUsdc,
        row.block
      );
      return { wallet: row.wallet, vol };
    });

    for (const { wallet, vol } of results) {
      if (vol > 0) {
        walletVolumes.set(wallet, (walletVolumes.get(wallet) || 0) + vol);
        creditedVolume += vol;
      }
      quoted += 1;
    }
    batch = [];
    state = { lastLineIndex: endLineIndex, walletVolumes, quoted, creditedVolume };

    if (quoted > 0 && quoted % 500 < batchSize) {
      process.stdout.write(
        `\r  quoted ${quoted.toLocaleString()} | volume $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} | get_dy ${quoter.quoteCalls.toLocaleString()} | fails ${quoter.quoteFailures}`
      );
    }

    if (endLineIndex >= 0 && endLineIndex % 10_000 < batchSize) {
      await saveShardCheckpoint(shardIndex, shardTotal, state);
    }
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineIndex += 1;
    if (lineIndex <= state.lastLineIndex) continue;
    if (lineIndex % shardTotal !== shardIndex) continue;

    const row = deserializeSwapRow(line);
    batch.push(row);

    if (batch.length >= batchSize) {
      await flushBatch(lineIndex);
    }
  }
  await flushBatch(lineIndex);

  process.stdout.write("\n");
  const stats = {
    quoted,
    creditedVolume,
    getDyCalls: quoter.quoteCalls,
    getDyFailures: quoter.quoteFailures,
  };
  await saveShardOutput(shardIndex, shardTotal, walletVolumes, stats, true);
  try {
    await unlink(shardCheckpointPath(shardIndex, shardTotal));
  } catch {
    /* done */
  }

  console.log(
    `  ${label} shard ${shardIndex}/${shardTotal}: ${quoted.toLocaleString()} quoted, $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} | get_dy ${quoter.quoteCalls.toLocaleString()}`
  );
  return { walletVolumes, stats };
}

async function quoteV2FromNdjson(walletVolumes) {
  try {
    await readFile(V2_SWAPS_FILE, "utf8");
  } catch {
    console.log("\n[merge] No v2-swaps.ndjson — skipping v2 quote");
    return { quoted: 0, creditedVolume: 0 };
  }

  console.log("\n[merge] Quoting v2 swaps (single pass)…");
  const quoter = createPoolUsdcQuoter(V2_SWAP_POOL_ADDRESS, { concurrency: QUOTE_CONCURRENCY });
  let quoted = 0;
  let creditedVolume = 0;
  const batch = [];
  const rows = [];

  const rl = createInterface({
    input: createReadStream(V2_SWAPS_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(deserializeSwapRow(line));
  }

  const results = await asyncPool(QUOTE_CONCURRENCY, rows, async (row) => {
    const vol = await usdVolumeUsdcEquivalent(
      row.i,
      row.j,
      row.dx,
      row.dy ?? null,
      quoter.quoteToUsdc,
      row.block
    );
    return { wallet: row.wallet, vol };
  });

  for (const { wallet, vol } of results) {
    quoted += 1;
    if (vol > 0) {
      walletVolumes.set(wallet, (walletVolumes.get(wallet) || 0) + vol);
      creditedVolume += vol;
    }
  }

  console.log(
    `  V2: ${quoted.toLocaleString()} quoted, $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} | get_dy ${quoter.quoteCalls.toLocaleString()}`
  );
  return { quoted, creditedVolume };
}

async function runQuoteOnly() {
  if (!SHARD) {
    throw new Error("--quote-only requires --shard N/M (e.g. --shard 7/30)");
  }

  const { shardIndex, shardTotal } = SHARD;
  const isV2 = SWAPS_FILE === V2_SWAPS_FILE || process.argv.includes("--v2");
  const poolAddress = isV2 ? V2_SWAP_POOL_ADDRESS : LEGACY_SWAP_POOL_ADDRESS;
  const label = isV2 ? "V2" : "Legacy";

  await quoteSwapRowsFromNdjson(SWAPS_FILE, poolAddress, SHARD, label);

  console.log("\n========================================");
  console.log(`QUOTE SHARD ${shardIndex}/${shardTotal} COMPLETE`);
  console.log("========================================");
}

async function runMergeShards() {
  const manifest = await loadManifest();
  const shardTotal = Number(manifest.shardTotal || argValue("--expect-shards") || 0);

  const files = (await readdir(MERGE_SHARDS_DIR))
    .filter((f) => /^shard-\d+-of-\d+\.json$/.test(f) && !f.includes(".checkpoint"))
    .sort();

  if (!files.length) {
    throw new Error(`No shard outputs in ${MERGE_SHARDS_DIR}. Run quote shards first.`);
  }

  const parsedShards = [];
  for (const file of files) {
    const raw = await readFile(join(MERGE_SHARDS_DIR, file), "utf8");
    const data = parseJsonText(raw);
    if (!data.complete) {
      throw new Error(`Shard incomplete: ${file}`);
    }
    parsedShards.push(data);
  }

  const expectedTotal = shardTotal || parsedShards[0]?.shardTotal || 0;
  if (expectedTotal > 1) {
    const indices = new Set(parsedShards.map((s) => Number(s.shardIndex)));
    const missing = [];
    for (let i = 0; i < expectedTotal; i++) {
      if (!indices.has(i)) missing.push(i);
    }
    if (missing.length) {
      throw new Error(
        `Missing ${missing.length} shard(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""} (expected ${expectedTotal})`
      );
    }
  }

  console.log(`\n[merge] Combining ${parsedShards.length} shard file(s)…`);
  const walletVolumes = new Map();
  let getDyCalls = 0;

  for (const shard of parsedShards) {
    for (const [wallet, vol] of shard.wallets || []) {
      const w = String(wallet).toLowerCase();
      walletVolumes.set(w, (walletVolumes.get(w) || 0) + toNumber(vol));
    }
    getDyCalls += Number(shard.getDyCalls || 0);
  }

  await quoteV2FromNdjson(walletVolumes);

  const txCount = Number(manifest.uniqueTxCount || manifest.legacySwapCount + manifest.v2SwapCount);
  const chainTotal = sumMap(walletVolumes);

  if (!DRY_RUN) await saveCheckpoint(walletVolumes, chainTotal, txCount);

  console.log("\n========================================");
  console.log("MERGE COMPLETE");
  console.log(`  Wallets:    ${walletVolumes.size.toLocaleString()}`);
  console.log(`  Volume:     $${chainTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`  Tx count:   ${txCount.toLocaleString()}`);
  console.log(`  get_dy sum: ${getDyCalls.toLocaleString()} (legacy shards)`);
  console.log(`  Checkpoint: ${CHECKPOINT_FILE}`);
  console.log("\nNext: npm run stats:backfill-apply-volume");
  console.log("========================================");

  return { walletVolumes, chainTotal, txCount };
}

async function runDumpAndQuoteLegacySingle(walletVolumes, seenTxHashes, latestBlock, legacyQuoter) {
  let swapCount = 0;
  let creditedVolume = 0;
  let batch = [];

  async function flushBatch() {
    if (!batch.length) return;
    const results = await asyncPool(QUOTE_CONCURRENCY, batch, async (row) => {
      const vol = await usdVolumeUsdcEquivalent(
        row.i,
        row.j,
        row.dx,
        null,
        legacyQuoter.quoteToUsdc,
        row.block
      );
      return { wallet: row.wallet, vol };
    });
    for (const { wallet, vol } of results) {
      if (vol > 0) {
        walletVolumes.set(wallet, (walletVolumes.get(wallet) || 0) + vol);
        creditedVolume += vol;
      }
    }
    if (swapCount > 0 && swapCount % 500 < batch.length) {
      process.stdout.write(
        `\r  quoted ${swapCount.toLocaleString()} | volume $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} | get_dy ${legacyQuoter.quoteCalls.toLocaleString()} | fails ${legacyQuoter.quoteFailures}`
      );
    }
    batch = [];
  }

  for await (const tx of streamTxlist(LEGACY_SWAP_POOL_ADDRESS, 0, latestBlock)) {
    if (tx.isError === "1" || !tx.input?.startsWith(SWAP_SELECTOR) || !tx.from) continue;
    const hash = String(tx.hash || "").toLowerCase();
    if (hash && seenTxHashes.has(hash)) continue;

    let decoded;
    try {
      decoded = swapTxIface.parseTransaction({ data: tx.input });
    } catch {
      continue;
    }
    if (decoded?.name !== "swap") continue;

    if (hash) seenTxHashes.add(hash);
    batch.push({
      wallet: String(tx.from).toLowerCase(),
      i: decoded.args[0],
      j: decoded.args[1],
      dx: decoded.args[2],
      block: Number(tx.blockNumber),
    });
    swapCount += 1;

    if (batch.length >= QUOTE_CONCURRENCY * 50) {
      await flushBatch();
    }
  }
  await flushBatch();

  console.log(
    `\n  Legacy: ${swapCount.toLocaleString()} swap txs, $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC-equiv | get_dy: ${legacyQuoter.quoteCalls.toLocaleString()}`
  );
  return { swapRows: swapCount, creditedVolume };
}

/**
 * @param {Set<string>} seenTxHashes — global dedup across legacy + v2
 */
async function aggregateLegacyVolumes(seenTxHashes, walletVolumes, latestBlock, legacyQuoter) {
  console.log("\n[1/4] Legacy pool on-chain swaps (USDC-equivalent volume)…");
  console.log(`  Stream Arcscan + quote (concurrency ${QUOTE_CONCURRENCY})…`);
  return runDumpAndQuoteLegacySingle(walletVolumes, seenTxHashes, latestBlock, legacyQuoter);
}

async function aggregateV2Volumes(seenTxHashes, walletVolumes, latestBlock, v2Quoter) {
  console.log("\n[2/4] V2 pool Swapped logs (USDC-equivalent volume)…");
  const fromBlock = SWAP_POOL_V2_FROM_BLOCK || 47_000_000;
  const logs = await fetchAllLogs(
    V2_SWAP_POOL_ADDRESS,
    SWAPPED_TOPIC,
    fromBlock,
    latestBlock,
    "v2 Swapped"
  );

  let swapRows = 0;
  let creditedVolume = 0;

  console.log(`  Quoting ${logs.length.toLocaleString()} v2 Swapped events to USDC…`);

  const rows = [];
  for (const log of logs) {
    const hash = String(log.transactionHash || "").toLowerCase();
    if (hash && seenTxHashes.has(hash)) continue;

    let parsed;
    try {
      parsed = swapLogIface.parseLog({
        topics: cleanTopics(log.topics),
        data: log.data,
      });
    } catch {
      continue;
    }
    if (parsed?.name !== "Swapped") continue;

    if (hash) seenTxHashes.add(hash);
    rows.push({
      wallet: String(parsed.args.user).toLowerCase(),
      i: parsed.args.i,
      j: parsed.args.j,
      dx: parsed.args.dx,
      dy: parsed.args.dy,
      block: parseBlockNumber(log.blockNumber),
    });
  }

  const results = await asyncPool(QUOTE_CONCURRENCY, rows, async (row) => {
    const vol = await usdVolumeUsdcEquivalent(
      row.i,
      row.j,
      row.dx,
      row.dy,
      v2Quoter.quoteToUsdc,
      row.block
    );
    return { wallet: row.wallet, vol };
  });

  for (const { wallet, vol } of results) {
    swapRows += 1;
    if (vol <= 0) continue;
    walletVolumes.set(wallet, (walletVolumes.get(wallet) || 0) + vol);
    creditedVolume += vol;
  }

  console.log(
    `  V2: ${swapRows.toLocaleString()} swap events, $${creditedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC-equiv | get_dy: ${v2Quoter.quoteCalls.toLocaleString()}`
  );
  return { swapRows, creditedVolume };
}

function buildProfileToWallet(walletToProfile) {
  const profileToWallet = new Map();
  for (const [wallet, profileKey] of walletToProfile) {
    profileToWallet.set(profileKey, wallet);
  }
  return profileToWallet;
}

async function buildProfileVolumeMap(walletVolumes, walletToProfile) {
  const profileVolumes = new Map();
  for (const [wallet, volume] of walletVolumes) {
    const profileKey = walletToProfile.get(wallet) || `profile:${wallet}`;
    profileVolumes.set(profileKey, (profileVolumes.get(profileKey) || 0) + volume);
  }
  return profileVolumes;
}

function sumMap(map) {
  let s = 0;
  for (const v of map.values()) s += toNumber(v);
  return s;
}

async function applyVolumesToRedis(walletVolumes, walletToProfile) {
  console.log("\n[3/4] Applying volumes to Redis (absolute set, swapCount unchanged)…");

  const profileToWallet = buildProfileToWallet(walletToProfile);

  /** @returns {number|null} null = skip (cannot resolve wallet); 0 = duplicate/non-canonical profile */
  function canonicalVolumeForProfile(profileKey, profile) {
    const member = profileKey.replace(/^profile:/, "");
    let wallet = member.startsWith("0x") ? member.toLowerCase() : "";
    if (!wallet) wallet = String(profile?.walletAddress || "").toLowerCase();
    if (!wallet.startsWith("0x")) wallet = profileToWallet.get(profileKey) || "";
    if (!wallet.startsWith("0x")) return null;

    const profileKeyForWallet = walletToProfile.get(wallet) || `profile:${wallet}`;
    if (profileKeyForWallet !== profileKey) return 0;
    return toNumber(walletVolumes.get(wallet) || 0);
  }

  let cursor = 0;
  let iterations = 0;
  let scanned = 0;
  const updates = [];

  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, { match: SCAN_MATCH, count: SCAN_COUNT });
    cursor = nextCursor;
    iterations += 1;

    if (Array.isArray(keys) && keys.length > 0) {
      const profiles = await kv.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const profileKey = keys[i];
        const profile = profiles[i];
        if (!profile || typeof profile !== "object") continue;
        scanned += 1;

        const oldVol = toNumber(profile.swapVolume || 0);
        const newVol = canonicalVolumeForProfile(profileKey, profile);
        if (newVol === null) continue;

        if (Math.abs(oldVol - newVol) < 0.000001) continue;

        updates.push({
          profileKey,
          member: profileKey.replace(/^profile:/, ""),
          newVol,
          oldVol,
        });
      }
    }

    if (iterations % 25 === 0) {
      process.stdout.write(
        `\r  profiles scanned: ${scanned.toLocaleString()}, pending updates: ${updates.length.toLocaleString()}`
      );
    }

    if (cursor === 0 || cursor === "0") break;
  }

  process.stdout.write("\n");

  const profileVolumes = await buildProfileVolumeMap(walletVolumes, walletToProfile);
  for (const [profileKey, newVol] of profileVolumes) {
    if (updates.some((u) => u.profileKey === profileKey)) continue;
    updates.push({
      profileKey,
      member: profileKey.replace(/^profile:/, ""),
      newVol: toNumber(newVol),
      oldVol: 0,
    });
  }

  console.log(`  Profiles to update: ${updates.length.toLocaleString()}`);
  if (DRY_RUN) {
    console.log("  [dry-run] Skipping Redis writes");
    return { updated: 0, totalVolume: sumMap(walletVolumes), profileVolumes };
  }

  const redis = getRedisPipeline();
  const BATCH = 500;
  let updated = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    if (redis) {
      const pipe = redis.pipeline();
      for (const row of batch) {
        pipe.hset(row.profileKey, "swapVolume", String(row.newVol));
      }
      await pipe.exec();
    } else {
      for (const row of batch) {
        await kv.hset(row.profileKey, { swapVolume: row.newVol });
      }
    }
    updated += batch.length;
    process.stdout.write(`\r  volume fields written: ${updated.toLocaleString()}/${updates.length.toLocaleString()}`);
  }
  process.stdout.write("\n");

  if (redis) await redis.quit();

  return { updated, totalVolume: sumMap(walletVolumes), profileVolumes };
}

async function rebuildLeaderboard(profileVolumes) {
  console.log("\n  Rebuilding leaderboard:swapVolume…");
  if (DRY_RUN) return;

  const redis = getRedisPipeline();
  if (redis) {
    await redis.del(LEADERBOARD_VOLUME_KEY);
    const entries = [...profileVolumes.entries()].filter(([, v]) => toNumber(v) > 0);
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const pipe = redis.pipeline();
      for (const [profileKey, volume] of batch) {
        const member = profileKey.replace(/^profile:/, "");
        pipe.zadd(LEADERBOARD_VOLUME_KEY, toNumber(volume), member);
      }
      await pipe.exec();
    }
    await redis.quit();
  } else {
    await kv.del(LEADERBOARD_VOLUME_KEY);
    for (const [profileKey, volume] of profileVolumes) {
      const v = toNumber(volume);
      if (v <= 0) continue;
      await kv.zadd(LEADERBOARD_VOLUME_KEY, {
        score: v,
        member: profileKey.replace(/^profile:/, ""),
      });
    }
  }
  console.log(`  Leaderboard rows: ${[...profileVolumes.values()].filter((v) => v > 0).length}`);
}

async function persistLandingStats(volumeStats, totalSwapCount, uniqueUsers) {
  console.log("\n[4/4] Updating stats keys + landing-network.json…");

  const { platformVolume, onChainVolume, onChainSwapCount, platformSwapCount, scaleFactor } =
    volumeStats;

  const mergedStats = {
    totalSwapVolume: platformVolume,
    totalSwapCount,
    uniqueUsers,
  };

  const volPayload = {
    totalSwapVolume: platformVolume,
    onChainSwapVolume: onChainVolume,
    onChainSwapCount,
    platformSwapCount,
    volumeScaleFactor: scaleFactor,
    source: "on_chain_usdc_equivalent_backfill",
    updatedAt: new Date().toISOString(),
  };

  if (!DRY_RUN) {
    const highwaterState = await kv.get(HIGHWATER_KEY);
    const previous = highwaterState?.latest || highwaterState || {};
    await kv.set(VOLUME_KEY, volPayload);
    await kv.set(HIGHWATER_KEY, {
      latest: mergedStats,
      previous: normalizeStats(previous),
      observed: mergedStats,
      updatedAt: Date.now(),
      source: "backfillSwapVolumeFromChain",
    });
  }

  const refreshedAt = new Date().toISOString();
  const landingPayload = {
    ok: true,
    refreshedAt,
    stats: mergedStats,
    leaderboard: {
      totalSwapVolume: platformVolume,
      totalSwapCount,
      uniqueUsers,
      egressSafe: true,
      scanFree: true,
    },
    source: "on-chain-volume-backfill",
    volumeMeta: {
      onChainSwapVolume: onChainVolume,
      onChainSwapCount,
      platformSwapCount,
      scaleFactor,
    },
  };

  if (!DRY_RUN) {
    await writeLandingPublicJsonFile(landingPayload);
    await mkdir(join(ROOT, "data/stats"), { recursive: true });
    await writeFile(
      join(ROOT, "data/stats/totalSwapVolume.latest.json"),
      `${JSON.stringify(volPayload, null, 2)}\n`,
      "utf8"
    );
  }

  console.log(`  on-chain volume:   $${onChainVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${onChainSwapCount.toLocaleString()} priced txs)`);
  console.log(`  platform volume: $${platformVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} (scaled to ${platformSwapCount.toLocaleString()} platform swaps)`);
  if (scaleFactor > 1.001) {
    console.log(`  scale factor:    ${scaleFactor.toFixed(4)}× (platform swaps / on-chain txs)`);
  }
  console.log(`  totalSwapCount:  ${totalSwapCount.toLocaleString()}`);
  console.log(`  uniqueUsers:     ${uniqueUsers.toLocaleString()}`);
  if (!DRY_RUN) console.log("  Wrote public/stats/landing-network.json");
}

function normalizeStats(stats) {
  return {
    totalSwapVolume: toNumber(stats?.totalSwapVolume),
    totalSwapCount: toNumber(stats?.totalSwapCount),
    uniqueUsers: toNumber(stats?.uniqueUsers),
  };
}

async function applyPhase(walletVolumes, txCount, { profilesOnly = false } = {}) {
  const walletToProfile = new Map();
  console.log("\nPreloading wallet → profile mappings…");
  await preloadWalletMappings(walletVolumes.keys(), walletToProfile);

  const onChainVolumeBeforeScale = sumMap(walletVolumes);

  let platformSwapCount = 0;
  let uniqueUsers = 0;
  let factor = 1;
  let onChainVolume = onChainVolumeBeforeScale;
  let platformVolume = onChainVolumeBeforeScale;

  if (!profilesOnly) {
    const [highwaterState, countStats] = await Promise.all([
      kv.get(HIGHWATER_KEY),
      kv.get(COUNT_KEY),
    ]);
    const previous = highwaterState?.latest || highwaterState || {};
    platformSwapCount = Math.max(
      toNumber(previous.totalSwapCount),
      toNumber(countStats?.totalSwapCount ?? countStats?.totalSwapCalls)
    );
    uniqueUsers = Math.max(
      toNumber(previous.uniqueUsers),
      toNumber(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets)
    );

    const scaled = scaleWalletVolumesToPlatform(walletVolumes, txCount, platformSwapCount);
    factor = scaled.factor;
    onChainVolume = scaled.onChainVolume;
    platformVolume = scaled.platformVolume;

    console.log(
      `\nVolume summary:\n` +
        `  On-chain priced: ${txCount.toLocaleString()} txs → $${onChainVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
        `  Platform swaps:  ${platformSwapCount.toLocaleString()} (Redis highwater)\n` +
        `  Landing total:   $${platformVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}` +
        (factor > 1.001 ? ` (${factor.toFixed(4)}× avg $/swap extrapolation)` : "")
    );
  } else {
    console.log(
      `\nProfiles-only re-apply (${walletVolumes.size.toLocaleString()} wallets from checkpoint, landing stats unchanged)`
    );
  }

  const { updated, profileVolumes } = await applyVolumesToRedis(walletVolumes, walletToProfile);
  await rebuildLeaderboard(profileVolumes);

  if (!profilesOnly) {
    await persistLandingStats(
      {
        platformVolume,
        onChainVolume: onChainVolumeBeforeScale,
        onChainSwapCount: txCount,
        platformSwapCount,
        scaleFactor: factor,
      },
      platformSwapCount,
      uniqueUsers
    );
  }

  console.log("\n========================================");
  console.log(profilesOnly ? "PROFILE VOLUME RE-APPLY COMPLETE" : "BACKFILL COMPLETE");
  console.log(`  Profiles updated: ${updated.toLocaleString()}`);
  if (!profilesOnly) {
    console.log(`  Platform volume:  $${platformVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  On-chain txs:     ${txCount.toLocaleString()}`);
    console.log(`  Platform swaps:   ${platformSwapCount.toLocaleString()}`);
  }
  console.log("========================================");
}

async function main() {
  console.log("SwapArc on-chain volume backfill (USDC-equivalent, pool get_dy quotes)");
  if (DRY_RUN) console.log("DRY RUN — no Redis writes\n");

  if (DUMP_ONLY) {
    await runDumpOnly();
    return;
  }

  if (QUOTE_ONLY) {
    await runQuoteOnly();
    return;
  }

  if (MERGE_SHARDS) {
    await runMergeShards();
    return;
  }

  if (APPLY_ONLY || PROFILES_ONLY) {
    const mode = PROFILES_ONLY ? "PROFILES ONLY" : "APPLY ONLY";
    console.log(`${mode} — loading checkpoint (skip chain scan)\n`);
    const loaded = await loadCheckpoint();
    await applyPhase(loaded.walletVolumes, loaded.txCount, { profilesOnly: PROFILES_ONLY });
    return;
  }

  let walletVolumes = new Map();
  let txCount = 0;

  try {
    await unlink(CHECKPOINT_FILE);
  } catch {
    /* no stale checkpoint */
  }

  const legacyQuoter = createPoolUsdcQuoter(LEGACY_SWAP_POOL_ADDRESS, {
    concurrency: QUOTE_CONCURRENCY,
  });
  const v2Quoter = createPoolUsdcQuoter(V2_SWAP_POOL_ADDRESS, { concurrency: QUOTE_CONCURRENCY });

  const latestBlock = await latestBlockNumber();
  console.log(`Latest block: ${latestBlock} | quote concurrency ${QUOTE_CONCURRENCY}`);

  const seenTxHashes = new Set();

  if (!SKIP_LEGACY) await aggregateLegacyVolumes(seenTxHashes, walletVolumes, latestBlock, legacyQuoter);
  if (!SKIP_V2) await aggregateV2Volumes(seenTxHashes, walletVolumes, latestBlock, v2Quoter);

  const chainTotal = sumMap(walletVolumes);
  txCount = seenTxHashes.size;
  console.log(
    `\nOn-chain aggregate: ${walletVolumes.size.toLocaleString()} wallets, $${chainTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC-equiv total`
  );
  console.log(`Unique tx hashes indexed: ${txCount.toLocaleString()}`);

  if (!DRY_RUN) await saveCheckpoint(walletVolumes, chainTotal, txCount);
  await applyPhase(walletVolumes, txCount);
}

main().catch((err) => {
  console.error("backfillSwapVolumeFromChain failed:", err);
  process.exit(1);
});
