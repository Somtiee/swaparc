/**
 * Export every active SwapArc profile for Dune (full leaderboard, 170k+ rows).
 * Merges wallet + username profiles like the profile page.
 *
 * Usage: npm run stats:export-dune-all-profiles
 * Output: data/dune-export/db/swaparc_all_profiles.csv
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { createClient } from "../lib/server/kv.js";
import {
  buildUserIdToWalletMap,
  leaderboardWalletId,
  mergeProfileStats,
} from "../lib/server/mergeLeaderboardProfile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.DUNE_EXPORT_OUT_DIR || join(ROOT, "data/dune-export/db");
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.DUNE_DB_SCAN_COUNT || 1000));

const kv = createClient();

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return `${cols.map(csvEscape).join(",")}\n`;
}

function invertWalletMap(userIdToWallet) {
  const walletToUser = new Map();
  for (const [userId, wallet] of userIdToWallet) {
    if (wallet?.startsWith("0x")) walletToUser.set(wallet.toLowerCase(), userId);
  }
  return walletToUser;
}

function resolveMergedInMemory(member, raw, byMember, userIdToWallet, walletToUser) {
  const id = String(member || "").trim();
  let merged = raw && typeof raw === "object" ? { ...raw } : {};

  if (id.startsWith("0x")) {
    const lower = id.toLowerCase();
    const mapped = walletToUser.get(lower);
    if (mapped && byMember.has(mapped)) {
      merged = mergeProfileStats(byMember.get(mapped), merged);
    }
    merged.walletAddress = lower;
    return merged;
  }

  let wallet = String(merged.walletAddress || "").toLowerCase();
  if (!wallet.startsWith("0x") && userIdToWallet.has(id)) {
    wallet = userIdToWallet.get(id);
  }
  if (wallet.startsWith("0x")) {
    const walletProfile = byMember.get(wallet) || byMember.get(wallet.toLowerCase());
    if (walletProfile) merged = mergeProfileStats(merged, walletProfile);
    merged.walletAddress = wallet;
  }

  return merged;
}

function canonicalKey(member, merged) {
  const wallet = leaderboardWalletId(member, merged);
  return wallet.startsWith("0x") ? wallet : member;
}

function isActive(p) {
  return (
    Number(p.swapCount) > 0 ||
    Number(p.swapVolume) > 0 ||
    Number(p.lpProvided) > 0
  );
}

async function loadAllProfiles() {
  const byMember = new Map();
  let cursor = 0;
  let iterations = 0;

  console.log("  Scanning profile:* …");

  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: SCAN_MATCH,
      count: SCAN_COUNT,
    });
    cursor = nextCursor;
    iterations += 1;

    if (Array.isArray(keys) && keys.length > 0) {
      const profiles = await kv.mget(...keys);
      for (let i = 0; i < keys.length; i += 1) {
        const member = keys[i].replace(/^profile:/, "");
        if (profiles[i]) byMember.set(member, profiles[i]);
      }
    }

    if (iterations % 50 === 0) {
      process.stdout.write(`\r  profile keys loaded: ${byMember.size.toLocaleString()}`);
    }

    if (cursor === 0 || cursor === "0") break;
    if (iterations > 2_000_000) throw new Error("Profile scan guard tripped");
  }

  process.stdout.write("\n");
  return byMember;
}

async function main() {
  console.log("SwapArc → export all profiles for Dune");
  console.log(`Output: ${OUT_DIR}/swaparc_all_profiles.csv`);

  console.log("\n  Building wallet ↔ username map…");
  const userIdToWallet = await buildUserIdToWalletMap(kv);
  const walletToUser = invertWalletMap(userIdToWallet);

  const byMember = await loadAllProfiles();

  console.log("  Merging wallet + username profiles in memory…");
  const canonical = new Map();

  for (const [member, raw] of byMember) {
    const merged = resolveMergedInMemory(member, raw, byMember, userIdToWallet, walletToUser);
    const key = canonicalKey(member, merged);
    const wallet = key.startsWith("0x") ? key : leaderboardWalletId(member, merged);
    const prev = canonical.get(key);
    const next = prev
      ? mergeProfileStats(prev, merged)
      : {
          ...merged,
          wallet: wallet.startsWith("0x") ? wallet : String(merged.walletAddress || ""),
          username: merged.username || "Anon",
        };
    if (!next.wallet?.startsWith("0x") && wallet.startsWith("0x")) {
      next.wallet = wallet;
    }
    canonical.set(key, next);
  }

  const active = [...canonical.values()].filter(isActive);
  console.log(`  Active profiles (swap/LP activity): ${active.length.toLocaleString()}`);

  active.sort((a, b) => Number(b.swapVolume) - Number(a.swapVolume) || Number(b.swapCount) - Number(a.swapCount));
  active.forEach((row, index) => {
    row.rank_by_volume = index + 1;
  });

  const lpActive = active
    .filter((r) => Number(r.lpProvided) > 0)
    .sort((a, b) => Number(b.lpProvided) - Number(a.lpProvided));
  const lpRank = new Map(
    lpActive.map((r, i) => {
      const key = r.wallet?.startsWith("0x") ? r.wallet : r.username;
      return [key, i + 1];
    })
  );

  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "swaparc_all_profiles.csv");
  const stream = createWriteStream(path, { encoding: "utf8" });
  stream.write(
    csvLine([
      "rank_by_volume",
      "rank_by_lp",
      "wallet",
      "username",
      "swap_volume",
      "swap_count",
      "lp_provided",
    ])
  );

  for (const row of active) {
    const key = row.wallet?.startsWith("0x") ? row.wallet : row.username;
    stream.write(
      csvLine([
        row.rank_by_volume,
        lpRank.get(key) || "",
        row.wallet?.startsWith("0x") ? row.wallet : "",
        row.username || "Anon",
        Number(row.swapVolume) || 0,
        Number(row.swapCount) || 0,
        Number(row.lpProvided) || 0,
      ])
    );
  }

  stream.end();
  await finished(stream);

  console.log("\n========================================");
  console.log(`Wrote ${path}`);
  console.log(`  Rows: ${active.length.toLocaleString()}`);
  console.log("  Next: npm run stats:upload-dune-profiles && npm run stats:fix-dune-queries");
  console.log("========================================");
}

main().catch((err) => {
  console.error("exportDuneAllProfiles failed:", err);
  process.exit(1);
});
