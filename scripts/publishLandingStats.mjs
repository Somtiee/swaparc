/**
 * Build public/stats/landing-network.json from Redis (run locally after weekly cron or before deploy).
 * Usage: REDIS_URL=... node scripts/publishLandingStats.mjs
 */

import "dotenv/config";
import { createClient } from "../lib/server/kv.js";
import {
  buildLandingPublicPayload,
  publishLandingPublicStats,
} from "../lib/server/landingPublicStats.js";

const kv = createClient();

async function main() {
  const countStats = await kv.get("stats:countUniqueSwappers:last");
  const volStats = await kv.get("stats:totalSwapVolume:last");
  const payload = await buildLandingPublicPayload({
    totalSwapVolume: Number(volStats?.totalSwapVolume) || 0,
    totalSwapCount:
      Number(countStats?.totalSwapCount ?? countStats?.totalSwapCalls) || 0,
    uniqueSwapWallets:
      Number(countStats?.uniqueUsers ?? countStats?.uniqueSwapWallets) || 0,
  });
  const url = await publishLandingPublicStats(payload);
  console.log("Wrote public/stats/landing-network.json");
  if (url) console.log("Blob URL:", url);
  console.log("refreshedAt:", payload.refreshedAt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
