#!/usr/bin/env node
/**
 * Copy Redis keys using pipelined TYPE + batched reads/writes (no DUMP/RESTORE).
 * DUMP/RESTORE often fails across providers (e.g. Upstash → Railway): "payload version or checksum wrong".
 *
 * Env:
 *   SOURCE_REDIS_URL, REDIS_URL — required (redis:// or rediss://)
 *   MIGRATE_BATCH_SIZE — keys per batch (default 80, max 500)
 *   MIGRATE_COMMAND_TIMEOUT_MS — per-command timeout (default 600000)
 */
import "dotenv/config";
import { Redis } from "ioredis";

const srcUrl = String(process.env.SOURCE_REDIS_URL || "").trim();
const dstUrl = String(process.env.REDIS_URL || "").trim();
const BATCH = Math.max(10, Math.min(500, Number(process.env.MIGRATE_BATCH_SIZE || 80) || 80));

if (!srcUrl.startsWith("redis://") && !srcUrl.startsWith("rediss://")) {
  console.error("Set SOURCE_REDIS_URL to the source Redis connection string.");
  process.exit(1);
}
if (!dstUrl.startsWith("redis://") && !dstUrl.startsWith("rediss://")) {
  console.error("Set REDIS_URL to the destination Redis connection string.");
  process.exit(1);
}

const redisOpts = {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
  connectTimeout: 30_000,
  commandTimeout: Number(process.env.MIGRATE_COMMAND_TIMEOUT_MS || 600_000),
};

const src = new Redis(srcUrl, redisOpts);
const dst = new Redis(dstUrl, redisOpts);

function fmtSec(ms) {
  return (ms / 1000).toFixed(1);
}

/** Single-key fallback for streams and rare types. */
async function copyKeyLegacy(key) {
  const t = await src.type(key);
  if (t === "string") {
    const v = await src.get(key);
    if (v != null) await dst.set(key, v);
    return;
  }
  if (t === "hash") {
    const h = await src.hgetall(key);
    await dst.del(key);
    const e = Object.entries(h);
    if (e.length) await dst.hset(key, ...e.flat());
    return;
  }
  if (t === "zset") {
    const z = await src.zrange(key, 0, -1, "WITHSCORES");
    await dst.del(key);
    for (let i = 0; i < z.length; i += 2) {
      await dst.zadd(key, Number(z[i + 1]), z[i]);
    }
    return;
  }
  if (t === "set") {
    const members = await src.smembers(key);
    await dst.del(key);
    if (members.length) await dst.sadd(key, ...members);
    return;
  }
  if (t === "list") {
    const items = await src.lrange(key, 0, -1);
    await dst.del(key);
    if (items.length) await dst.rpush(key, ...items);
    return;
  }
  console.warn(`Skip ${key}: unsupported type ${t}`);
}

/**
 * Batched copy: 1× TYPE pipeline, then per-type pipelines (no DUMP/RESTORE).
 */
async function copyBatch(keys) {
  if (keys.length === 0) return { copied: 0, legacy: 0 };

  const tp = src.pipeline();
  for (const k of keys) {
    tp.type(k);
  }
  const typeRows = await tp.exec();

  const buckets = {
    string: [],
    hash: [],
    zset: [],
    set: [],
    list: [],
    other: [],
  };

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const t = String(typeRows[i]?.[1] || "").toLowerCase();
    if (t === "string") buckets.string.push(key);
    else if (t === "hash") buckets.hash.push(key);
    else if (t === "zset") buckets.zset.push(key);
    else if (t === "set") buckets.set.push(key);
    else if (t === "list") buckets.list.push(key);
    else buckets.other.push(key);
  }

  let legacy = 0;

  if (buckets.string.length) {
    const p = src.pipeline();
    buckets.string.forEach((k) => p.get(k));
    const got = await p.exec();
    const d = dst.pipeline();
    buckets.string.forEach((k, i) => {
      const v = got[i]?.[1];
      if (v != null && v !== undefined) d.set(k, v);
    });
    await d.exec();
  }

  if (buckets.hash.length) {
    const p = src.pipeline();
    buckets.hash.forEach((k) => p.hgetall(k));
    const rows = await p.exec();
    const d = dst.pipeline();
    buckets.hash.forEach((k, i) => {
      const obj = rows[i]?.[1];
      d.del(k);
      if (obj && typeof obj === "object" && Object.keys(obj).length) {
        const flat = Object.entries(obj).flatMap(([a, b]) => [a, String(b)]);
        d.hset(k, ...flat);
      }
    });
    await d.exec();
  }

  if (buckets.zset.length) {
    const p = src.pipeline();
    buckets.zset.forEach((k) => p.zrange(k, 0, -1, "WITHSCORES"));
    const rows = await p.exec();
    const d = dst.pipeline();
    buckets.zset.forEach((k, i) => {
      const z = rows[i]?.[1];
      d.del(k);
      if (Array.isArray(z) && z.length) {
        for (let j = 0; j < z.length; j += 2) {
          d.zadd(k, Number(z[j + 1]), z[j]);
        }
      }
    });
    await d.exec();
  }

  if (buckets.set.length) {
    const p = src.pipeline();
    buckets.set.forEach((k) => p.smembers(k));
    const rows = await p.exec();
    const d = dst.pipeline();
    buckets.set.forEach((k, i) => {
      const members = rows[i]?.[1];
      d.del(k);
      if (Array.isArray(members) && members.length) d.sadd(k, ...members);
    });
    await d.exec();
  }

  if (buckets.list.length) {
    const p = src.pipeline();
    buckets.list.forEach((k) => p.lrange(k, 0, -1));
    const rows = await p.exec();
    const d = dst.pipeline();
    buckets.list.forEach((k, i) => {
      const items = rows[i]?.[1];
      d.del(k);
      if (Array.isArray(items) && items.length) d.rpush(k, ...items);
    });
    await d.exec();
  }

  for (const k of buckets.other) {
    await copyKeyLegacy(k);
    legacy += 1;
  }

  return { copied: keys.length, legacy };
}

async function main() {
  const t0 = Date.now();
  console.log("Migration: pinging source and destination Redis...");
  await src.ping();
  await dst.ping();

  let approx = null;
  try {
    approx = await src.dbsize();
    console.log(`Source database has ~${approx} keys (DBSIZE).`);
  } catch {
    console.log("Could not read DBSIZE on source.");
  }

  console.log(
    `Using pipelined copy (no DUMP/RESTORE — safe across Upstash ↔ Railway), ${BATCH} keys/batch. ` +
      `Timeout ${redisOpts.commandTimeout}ms/command.`
  );

  let cursor = "0";
  let total = 0;
  let totalLegacy = 0;
  let pending = [];

  const flush = async () => {
    while (pending.length >= BATCH) {
      const chunk = pending.splice(0, BATCH);
      const tBatch = Date.now();
      const { copied, legacy } = await copyBatch(chunk);
      total += copied;
      totalLegacy += legacy;
      const elapsed = Date.now() - t0;
      const pct = approx ? ((total / approx) * 100).toFixed(2) : "?";
      const batchMs = Date.now() - tBatch;
      console.log(
        `[batch] +${copied} keys → total ${total}${approx != null ? ` / ~${approx}` : ""} (~${pct}%) — ` +
          `${fmtSec(elapsed)}s elapsed — this batch ${fmtSec(batchMs)}s` +
          (legacy ? ` (rare-type legacy: ${legacy})` : "")
      );
    }
  };

  do {
    const [next, keys] = await src.scan(cursor, "COUNT", 1000);
    cursor = next;
    for (const key of keys) {
      pending.push(key);
      await flush();
    }
  } while (cursor !== "0");

  if (pending.length) {
    const chunk = pending.splice(0);
    const tBatch = Date.now();
    const { copied, legacy } = await copyBatch(chunk);
    total += copied;
    totalLegacy += legacy;
    console.log(
      `[batch] final +${copied} keys in ${fmtSec(Date.now() - tBatch)}s` +
        (legacy ? ` (rare-type legacy: ${legacy})` : "")
    );
  }

  console.log(
    `Done. ${total} keys processed in ${fmtSec(Date.now() - t0)}s total.` +
      (totalLegacy ? ` (${totalLegacy} keys used single-key fallback for uncommon types)` : "")
  );
  await src.quit();
  await dst.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
