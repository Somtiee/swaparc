/**
 * Freeze Elite Swaparcer holders (mirrors snapshotEarlySwaparcers.js).
 *
 * Elite criteria (client truth, SwaparcApp badgeState): at least 2 of 4 goals.
 *   1. 100+ swaps                  -> profile.swapCount
 *   2. $10,000+ swap volume        -> profile.swapVolume
 *   3. $1,000+ total LP value      -> profile.lpProvided
 *      (client also requires LP in 2+ pools; per-pool breakdown is not stored
 *       on the profile, so this is approximated by total value. Each frozen
 *       entry records which conditions matched so borderline cases can be
 *       audited from the snapshot file.)
 *   4. 20+ successful recurring payments -> privpay:bills:state:<wallet> +
 *      privpay:payroll:state:<wallet> history rows (fetched only when this
 *      condition is the deciding one).
 * Sticky: profiles already flagged badges.eliteSwaparcer qualify regardless.
 *
 * Env:
 *   REDIS_URL (or KV_REST_API_URL + KV_REST_API_TOKEN) — production KV
 *   SNAPSHOT_DRY_RUN=1 (or --dry-run) — report only, no badge writes,
 *     no frozen file / KV key written.
 *
 * Output:
 *   data/badges/eliteSwaparcer.frozen.json
 *   KV key badges:eliteSwaparcer:frozen
 *   Console report: Early / Elite / both-badges counts.
 *
 * Usage:
 *   npm run snapshot:elite            # freeze + persist badges
 *   npm run snapshot:elite -- --dry-run
 */
import "dotenv/config";
import { createClient } from "../lib/server/kv.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";

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

const DRY_RUN = process.env.SNAPSHOT_DRY_RUN === "1" || process.argv.includes("--dry-run");

const kv = createClient();

const FROZEN_KV_KEY = "badges:eliteSwaparcer:frozen";
const EARLY_FROZEN_KV_KEY = "badges:earlySwaparcer:frozen";
const FROZEN_FILE_URL = new URL(
  "../data/badges/eliteSwaparcer.frozen.json",
  import.meta.url
);
const EARLY_FROZEN_FILE_URL = new URL(
  "../data/badges/earlySwaparcer.frozen.json",
  import.meta.url
);
const FROZEN_DIR_URL = new URL("../data/badges/", import.meta.url);

// Mirrors the client's 2-of-4 Elite Swaparcer goals (SwaparcApp badgeState).
const SWAP_COUNT_THRESHOLD = 100;
const SWAP_VOLUME_THRESHOLD = 10_000;
const LP_TOTAL_THRESHOLD = 1_000;
const RECURRING_THRESHOLD = 20;

const RECURRING_FETCH_CONCURRENCY = 20;

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

/** Same success filter the client uses for bill/payroll history rows. */
function isSuccessfulRecurringEntry(e) {
  const s = String(e?.status || "").toLowerCase();
  if (s === "failed" || s === "retry") return false;
  return (
    Boolean(e?.txHash) ||
    s === "success" ||
    s === "settled" ||
    s.startsWith("submitted")
  );
}

function countRecurringFromState(billsState, payrollState) {
  const bills = Array.isArray(billsState?.bills) ? billsState.bills : [];
  const history = Array.isArray(payrollState?.history) ? payrollState.history : [];
  return [...bills, ...history].filter(isSuccessfulRecurringEntry).length;
}

/**
 * Recurring counts are only needed when they are the deciding condition
 * (exactly one of the other goals met). Fetch with bounded concurrency.
 */
async function fetchRecurringCounts(candidates) {
  const queue = [...candidates];
  let done = 0;

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      let recurringCount = 0;
      try {
        const [billsState, payrollState] = await Promise.all([
          kv.get(`privpay:bills:state:${item.wallet}`).catch(() => null),
          kv.get(`privpay:payroll:state:${item.wallet}`).catch(() => null),
        ]);
        recurringCount = countRecurringFromState(billsState, payrollState);
      } catch {
        recurringCount = 0;
      }
      item.recurringCount = recurringCount;
      done += 1;
      process.stdout.write(`\rRecurring lookups: ${done}/${candidates.length}   `);
    }
  }

  await Promise.all(
    Array.from({ length: RECURRING_FETCH_CONCURRENCY }, () => worker())
  );
  process.stdout.write("\n");
}

async function persistBadgeOnProfile(profileKey, existingBadges) {
  const badges = parseBadges(existingBadges);
  if (badges.eliteSwaparcer === true) return false;
  const updated = { ...badges, eliteSwaparcer: true };
  try {
    await kv.hset(profileKey, { badges: JSON.stringify(updated) });
    return true;
  } catch (err) {
    console.error(`Failed to persist badge on ${profileKey}:`, err?.message || err);
    return false;
  }
}

async function loadEarlyAddresses() {
  const merged = new Set();
  try {
    const raw = await readFile(EARLY_FROZEN_FILE_URL, "utf8");
    const json = JSON.parse(raw);
    for (const a of json.addresses || []) {
      const n = String(a || "").trim().toLowerCase();
      if (n) merged.add(n);
    }
  } catch {
    /* file-only fallback below */
  }
  try {
    const raw = await kv.get(EARLY_FROZEN_KV_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const addrs = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.addresses)
        ? parsed.addresses
        : [];
    for (const a of addrs) {
      const n = String(a || "").trim().toLowerCase();
      if (n) merged.add(n);
    }
  } catch {
    /* KV unreadable — file is enough */
  }
  return merged;
}

async function main() {
  console.log(
    DRY_RUN
      ? "Snapshotting Elite Swaparcer holders (DRY RUN — no writes)..."
      : "Snapshotting Elite Swaparcer holders..."
  );
  console.log(
    `Criteria: at least 2 of { ${SWAP_COUNT_THRESHOLD}+ swaps, $${SWAP_VOLUME_THRESHOLD.toLocaleString()}+ volume, $${LP_TOTAL_THRESHOLD.toLocaleString()}+ LP, ${RECURRING_THRESHOLD}+ recurring } — or already has the badge.`
  );

  let cursor = 0;
  let scanned = 0;
  let qualifiedCount = 0;
  let stickyCount = 0;
  let promotedCount = 0;
  const holders = new Map(); // address -> minimal record
  const borderline = []; // needs a recurring lookup to decide

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

        const badges = parseBadges(profile?.badges);
        const sticky = badges?.eliteSwaparcer === true || badges?.eliteSwaparcer === "true";

        const has100Swaps = Number(profile?.swapCount || 0) >= SWAP_COUNT_THRESHOLD;
        const has10kVolume = Number(profile?.swapVolume || 0) >= SWAP_VOLUME_THRESHOLD;
        const has1kLp = Number(profile?.lpProvided || 0) >= LP_TOTAL_THRESHOLD;
        const cheapCompleted = [has100Swaps, has10kVolume, has1kLp].filter(Boolean).length;

        if (!sticky && cheapCompleted < 2) {
          // Recurring can only decide when exactly one other goal is met.
          if (cheapCompleted === 1) {
            const wallet = String(profile?.walletAddress || "")
              .trim()
              .toLowerCase();
            if (wallet.startsWith("0x")) {
              borderline.push({ key, profile, wallet, sticky });
            }
          }
          continue;
        }

        const userId = String(key || "").replace(/^profile:/, "");
        const address = String(profile.walletAddress || userId || "")
          .trim()
          .toLowerCase();
        if (!address) continue;

        qualifiedCount += 1;
        if (sticky) stickyCount += 1;
        holders.set(address, {
          address,
          userId,
          username: profile.username || "",
          swapCount: Number(profile.swapCount || 0),
          swapVolume: Number(profile.swapVolume || 0),
          lpProvided: Number(profile.lpProvided || 0),
          recurringCount: null,
          conditions: [
            has100Swaps ? "swaps" : null,
            has10kVolume ? "volume" : null,
            has1kLp ? "lp" : null,
          ].filter(Boolean),
          sticky,
          // kept for badge merge on persist; stripped before freezing to disk
          badgesObj: parseBadges(profile?.badges),
        });
      }

      process.stdout.write(
        `\rScanned ${scanned} profiles | qualified ${qualifiedCount} | pending recurring ${borderline.length}`
      );
    }
  } while (cursor !== 0 && cursor !== "0");

  if (borderline.length) {
    console.log(
      `\nResolving ${borderline.length} borderline profile(s) via bills/payroll history...`
    );
    await fetchRecurringCounts(borderline);

    for (const item of borderline) {
      if (item.recurringCount < RECURRING_THRESHOLD) continue;
      const profile = item.profile;
      const userId = String(item.key || "").replace(/^profile:/, "");
      const address = String(profile.walletAddress || userId || "")
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
        recurringCount: item.recurringCount,
        conditions: ["recurring", Number(profile.swapCount || 0) >= SWAP_COUNT_THRESHOLD ? "swaps" : null, Number(profile.swapVolume || 0) >= SWAP_VOLUME_THRESHOLD ? "volume" : null, Number(profile.lpProvided || 0) >= LP_TOTAL_THRESHOLD ? "lp" : null].filter(Boolean),
        sticky: false,
        badgesObj: parseBadges(profile?.badges),
      });
    }
  }

  // Persist the sticky badge on every qualifying profile (skip in dry run).
  // Existing badge flags (e.g. earlySwaparcer) are merged, never clobbered.
  if (!DRY_RUN) {
    for (const entry of holders.values()) {
      if (entry.sticky) continue;
      const profileKey = `profile:${entry.userId}`;
      const promoted = await persistBadgeOnProfile(profileKey, entry.badgesObj);
      if (promoted) promotedCount += 1;
    }
  }

  console.log("\n========================================");
  console.log(`Total profiles scanned : ${scanned}`);
  console.log(`Total Elite holders    : ${holders.size}`);
  console.log(`  via sticky badge     : ${stickyCount}`);
  console.log(`  promoted now         : ${DRY_RUN ? "(dry run)" : holders.size - stickyCount}`);
  console.log("========================================");

  // Cross-badge report: Early ∩ Elite.
  const earlyAddresses = await loadEarlyAddresses();
  const eliteAddresses = new Set(holders.keys());
  let bothCount = 0;
  for (const a of eliteAddresses) {
    if (earlyAddresses.has(a)) bothCount += 1;
  }

  console.log("\n--- Badge census ---");
  console.log(`Early Swaparcer holders : ${earlyAddresses.size}`);
  console.log(`Elite Swaparcer holders  : ${eliteAddresses.size}`);
  console.log(`Both badges             : ${bothCount}`);

  if (DRY_RUN) {
    console.log("\nDry run complete — nothing was written (no badges, no frozen list).");
    return;
  }

  const frozenAt = new Date().toISOString();
  const addresses = Array.from(holders.keys()).sort();
  const entries = Array.from(holders.values())
    .map(({ badgesObj, ...rest }) => rest)
    .sort((a, b) => a.address.localeCompare(b.address));

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
    console.log(`\nSaved local snapshot file: ${FROZEN_FILE_URL.pathname}`);
  } catch (err) {
    console.error("Failed to write local frozen snapshot file:", err?.message || err);
  }

  try {
    await kv.set(FROZEN_KV_KEY, payload);
    console.log(`Saved frozen list to KV key: ${FROZEN_KV_KEY}`);
  } catch (err) {
    console.error("Failed to persist frozen list to KV:", err?.message || err);
  }

  console.log(
    "\nTestnet Elite earning is now closed. Existing holders are preserved; no new wallets can earn the badge."
  );
}

main().catch((err) => {
  console.error("snapshotEliteSwaparcers crashed:", err);
  process.exit(1);
});
