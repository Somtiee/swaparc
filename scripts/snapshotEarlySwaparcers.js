import "dotenv/config";
import { createClient } from "../lib/server/kv.js";
import { mkdir, writeFile } from "node:fs/promises";

const ru = String(process.env.REDIS_URL || "").trim();
const hasRedis = ru.startsWith("redis://") || ru.startsWith("rediss://");
const hasUpstash =
  String(process.env.KV_REST_API_URL || "").trim() &&
  String(process.env.KV_REST_API_TOKEN || "").trim();

if (!hasRedis && !hasUpstash) {
  console.error(
    "Missing REDIS_URL (recommended) or KV_REST_API_URL + KV_REST_API_TOKEN in .env"
  );
  process.exit(1);
}

const kv = createClient();

const FROZEN_KV_KEY = "badges:earlySwaparcer:frozen";
const FROZEN_FILE_URL = new URL(
  "../data/badges/earlySwaparcer.frozen.json",
  import.meta.url
);
const FROZEN_DIR_URL = new URL("../data/badges/", import.meta.url);

const SWAP_COUNT_THRESHOLD = 100;
const SWAP_VOLUME_THRESHOLD = 10_000;
const LP_PROVIDED_THRESHOLD = 1_000;

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

function qualifies(profile) {
  const swapCount = Number(profile?.swapCount || 0);
  const swapVolume = Number(profile?.swapVolume || 0);
  const lpProvided = Number(profile?.lpProvided || 0);
  if (swapCount >= SWAP_COUNT_THRESHOLD) return true;
  if (swapVolume >= SWAP_VOLUME_THRESHOLD) return true;
  if (lpProvided >= LP_PROVIDED_THRESHOLD) return true;
  const badges = parseBadges(profile?.badges);
  if (badges?.earlySwaparcer === true || badges?.earlySwaparcer === "true") return true;
  return false;
}

async function persistBadgeOnProfile(profileKey, existingProfile) {
  const badges = parseBadges(existingProfile?.badges);
  if (badges.earlySwaparcer === true) return false;
  const updated = { ...badges, earlySwaparcer: true };
  try {
    await kv.hset(profileKey, { badges: JSON.stringify(updated) });
    return true;
  } catch (err) {
    console.error(`Failed to persist badge on ${profileKey}:`, err?.message || err);
    return false;
  }
}

async function main() {
  console.log("Snapshotting Early Swaparcer holders...");
  console.log(
    `Criteria: ${SWAP_COUNT_THRESHOLD}+ swaps OR $${SWAP_VOLUME_THRESHOLD.toLocaleString()}+ volume OR $${LP_PROVIDED_THRESHOLD.toLocaleString()}+ LP, OR already has badge.`
  );

  let cursor = 0;
  let scanned = 0;
  let qualifiedCount = 0;
  let promotedCount = 0;
  const holders = new Map(); // address -> minimal record

  do {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: "profile:*",
      count: 200,
    });
    cursor = nextCursor;

    if (Array.isArray(keys) && keys.length > 0) {
      const pipelines = kv.pipeline();
      keys.forEach((key) => pipelines.hgetall(key));
      const profiles = await pipelines.exec();

      for (let i = 0; i < profiles.length; i += 1) {
        const profile = profiles[i];
        const key = keys[i];
        scanned += 1;
        if (!profile) continue;
        if (!qualifies(profile)) continue;

        const userId = String(key || "").replace(/^profile:/, "");
        const address = String(
          profile.walletAddress || userId || ""
        )
          .trim()
          .toLowerCase();
        if (!address) continue;

        qualifiedCount += 1;
        holders.set(address, {
          address,
          userId,
          username: profile.username || "",
          swapCount: Number(profile.swapCount || 0),
          swapVolume: Number(profile.swapVolume || 0),
          lpProvided: Number(profile.lpProvided || 0),
        });

        const promoted = await persistBadgeOnProfile(key, profile);
        if (promoted) promotedCount += 1;
      }

      process.stdout.write(
        `\rScanned ${scanned} profiles | qualified ${qualifiedCount} | promoted ${promotedCount}`
      );
    }
  } while (cursor !== 0 && cursor !== "0");

  console.log("\n========================================");
  console.log(`Total profiles scanned : ${scanned}`);
  console.log(`Total holders frozen   : ${holders.size}`);
  console.log(`Profiles promoted now  : ${promotedCount}`);
  console.log("========================================");

  const frozenAt = new Date().toISOString();
  const addresses = Array.from(holders.keys()).sort();
  const entries = Array.from(holders.values()).sort((a, b) =>
    a.address.localeCompare(b.address)
  );

  const payload = {
    version: 1,
    frozenAt,
    count: addresses.length,
    addresses,
    entries,
  };

  try {
    await mkdir(FROZEN_DIR_URL, { recursive: true });
    await writeFile(FROZEN_FILE_URL, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Saved local snapshot file: ${FROZEN_FILE_URL.pathname}`);
  } catch (err) {
    console.error(
      "Failed to write local frozen snapshot file:",
      err?.message || err
    );
  }

  try {
    await kv.set(FROZEN_KV_KEY, payload);
    console.log(`Saved frozen list to KV key: ${FROZEN_KV_KEY}`);
  } catch (err) {
    console.error(
      "Failed to persist frozen list to KV:",
      err?.message || err
    );
  }

  console.log(
    "\nClaiming is now closed. Existing holders are preserved; no new wallets can earn the badge."
  );
}

main().catch((err) => {
  console.error("snapshotEarlySwaparcers crashed:", err);
  process.exit(1);
});
