import "dotenv/config";
import { createClient } from "../lib/server/kv.js";
import { mkdir, writeFile } from "node:fs/promises";

const kv = createClient();
const STATS_KEY = "stats:totalSwapVolume:last";
const OUTPUT_DIR_URL = new URL("../data/stats/", import.meta.url);
const OUTPUT_FILE_URL = new URL("../data/stats/totalSwapVolume.latest.json", import.meta.url);
const SCAN_MATCH = "profile:*";
const SCAN_COUNT = Math.max(100, Number(process.env.SUM_PROFILE_VOLUME_SCAN_COUNT || 1000));

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const startedAt = Date.now();
  let cursor = 0;
  let scannedProfiles = 0;
  let iterations = 0;
  let totalSwapVolume = 0;
  let activeSwapProfiles = 0;

  while (true) {
    const [nextCursor, keys] = await kv.scan(cursor, {
      match: SCAN_MATCH,
      count: SCAN_COUNT,
    });
    cursor = nextCursor;

    if (Array.isArray(keys) && keys.length > 0) {
      const profiles = await kv.mget(...keys);
      for (const profile of profiles || []) {
        if (!profile || typeof profile !== "object") continue;
        scannedProfiles += 1;
        const vol = toNumber(profile.swapVolume || 0);
        totalSwapVolume += vol;
        if (vol > 0) activeSwapProfiles += 1;
      }
    }

    iterations += 1;
    if (iterations % 100 === 0) {
      console.log(
        `[sumProfileSwapVolume] batches=${iterations}, scannedProfiles=${scannedProfiles}, totalSwapVolume=${totalSwapVolume.toLocaleString()}`
      );
    }

    if (cursor === 0 || cursor === "0") break;
    if (iterations > 1_000_000) {
      throw new Error("Scan aborted: exceeded maximum iteration guard.");
    }
  }

  const finishedAt = Date.now();
  const payload = {
    totalSwapVolume,
    activeSwapProfiles,
    scannedProfiles,
    scanBatchSize: SCAN_COUNT,
    updatedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
  };

  await mkdir(OUTPUT_DIR_URL, { recursive: true });
  await writeFile(OUTPUT_FILE_URL, JSON.stringify(payload, null, 2), "utf8");
  await kv.set(STATS_KEY, payload);

  console.log("========================================");
  console.log("[sumProfileSwapVolume] completed");
  console.log(`scannedProfiles: ${scannedProfiles}`);
  console.log(`activeSwapProfiles: ${activeSwapProfiles}`);
  console.log(`totalSwapVolume: ${totalSwapVolume.toLocaleString()}`);
  console.log(`saved file: ${OUTPUT_FILE_URL.pathname}`);
  console.log(`saved kv key: ${STATS_KEY}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("sumProfileSwapVolume crashed:", err);
  process.exit(1);
});
