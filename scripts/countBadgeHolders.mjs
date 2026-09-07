/**
 * Fast badge holder counts.
 * Early: frozen snapshot file (+ Redis key if present).
 * Elite: scan profile:* and HGET badges only (not HGETALL).
 *
 * Usage: node scripts/countBadgeHolders.mjs
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import Redis from "ioredis";
import {
  EARLY_SWAPARCER_FROZEN_KV_KEY,
} from "../lib/server/earlySwaparcerFrozen.js";

const ru = String(process.env.REDIS_URL || "").trim();
if (!ru.startsWith("redis://") && !ru.startsWith("rediss://")) {
  console.error("Missing REDIS_URL in .env");
  process.exit(1);
}

const redis = new Redis(ru, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  connectTimeout: 20000,
  commandTimeout: 60000,
});

function parseBadges(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeAddress(value) {
  const s = String(value || "").trim().toLowerCase();
  return s.startsWith("0x") && s.length === 42 ? s : "";
}

async function countEarly() {
  const raw = await readFile(
    new URL("../data/badges/earlySwaparcer.frozen.json", import.meta.url),
    "utf8"
  );
  const json = JSON.parse(raw);
  const addresses = Array.isArray(json.addresses) ? json.addresses : [];
  const unique = new Set(addresses.map((a) => String(a).toLowerCase()).filter(Boolean));

  let redisUnique = null;
  try {
    const kvRaw = await redis.get(EARLY_SWAPARCER_FROZEN_KV_KEY);
    if (kvRaw) {
      const parsed = JSON.parse(kvRaw);
      const addrs = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.addresses)
          ? parsed.addresses
          : [];
      redisUnique = new Set(addrs.map((a) => String(a).toLowerCase()).filter(Boolean)).size;
    }
  } catch {
    redisUnique = null;
  }

  const merged = new Set(unique);
  if (redisUnique != null) {
    try {
      const kvRaw = await redis.get(EARLY_SWAPARCER_FROZEN_KV_KEY);
      const parsed = JSON.parse(kvRaw);
      const addrs = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.addresses)
          ? parsed.addresses
          : [];
      for (const a of addrs) merged.add(String(a).toLowerCase());
    } catch {
      /* file-only */
    }
  }

  return {
    frozenAt: json.frozenAt || null,
    fileUnique: unique.size,
    redisUnique,
    mergedUnique: merged.size,
  };
}

async function countElite() {
  let cursor = "0";
  let keysSeen = 0;
  let profilesWithBadges = 0;
  let eliteFlags = 0;
  const eliteWallets = new Set();
  const samples = [];
  const t0 = Date.now();

  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "profile:*", "COUNT", 2000);
    cursor = String(next);
    if (!keys.length) continue;

    keysSeen += keys.length;

    // Pipeline HGET badges (+ walletAddress for unique wallet count)
    const pipe = redis.pipeline();
    for (const key of keys) {
      pipe.hget(key, "badges");
      pipe.hget(key, "walletAddress");
    }
    const rows = await pipe.exec();

    for (let i = 0; i < keys.length; i++) {
      const badgesRes = rows[i * 2];
      const walletRes = rows[i * 2 + 1];
      const badgesRaw = badgesRes?.[1];
      if (badgesRaw == null) continue;
      profilesWithBadges++;
      const badges = parseBadges(badgesRaw);
      if (badges.eliteSwaparcer === true || badges.eliteSwaparcer === "true") {
        eliteFlags++;
        const userId = String(keys[i]).replace(/^profile:/, "");
        const wallet =
          normalizeAddress(walletRes?.[1]) || normalizeAddress(userId);
        if (wallet) eliteWallets.add(wallet);
        if (samples.length < 15) samples.push(wallet || userId);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(
      `\rElite scan: keys=${keysSeen} elite=${eliteFlags} uniqueWallets=${eliteWallets.size} (${elapsed}s)   `
    );
  } while (cursor !== "0");

  process.stdout.write("\n");
  return {
    keysSeen,
    profilesWithBadges,
    eliteFlags,
    eliteUniqueWallets: eliteWallets.size,
    samples,
    elapsedMs: Date.now() - t0,
  };
}

async function main() {
  console.log("=== Badge holder count ===\n");

  console.log("[1/2] Early Swaparcer (frozen snapshot)...");
  const early = await countEarly();
  console.log(`  frozenAt:     ${early.frozenAt}`);
  console.log(`  file unique:  ${early.fileUnique}`);
  console.log(`  redis unique: ${early.redisUnique ?? "(no key / unreadable)"}`);
  console.log(`  merged unique (app truth): ${early.mergedUnique}`);

  console.log("\n[2/2] Elite Swaparcer (sticky profile badges)...");
  const elite = await countElite();
  console.log(`  profile keys scanned: ${elite.keysSeen}`);
  console.log(`  profiles with badges: ${elite.profilesWithBadges}`);
  console.log(`  elite badge flags:    ${elite.eliteFlags}`);
  console.log(`  unique wallets:       ${elite.eliteUniqueWallets}`);
  console.log(`  elapsed:              ${(elite.elapsedMs / 1000).toFixed(1)}s`);
  if (elite.samples.length) {
    console.log(`  sample: ${elite.samples.join(", ")}`);
  }

  console.log("\n========================================");
  console.log(`EARLY SWAPARCER HOLDERS:  ${early.mergedUnique}`);
  console.log(
    `ELITE SWAPARCER HOLDERS:  ${elite.eliteUniqueWallets || elite.eliteFlags}`
  );
  console.log("========================================");

  await redis.quit();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
