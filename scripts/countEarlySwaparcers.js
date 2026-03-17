import "dotenv/config";
import { createClient } from "@vercel/kv";

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env");
  process.exit(1);
}

const kv = createClient({
  url: process.env.KV_REST_API_URL.trim(),
  token: process.env.KV_REST_API_TOKEN.trim(),
});

async function main() {
  console.log("Starting Early Swaparcer check...");
  console.log("Criteria: 100+ swaps OR $10k+ volume OR $1k+ LP provided");

  let cursor = 0;
  const earlySwaparcers = [];
  let totalProfilesScanned = 0;

  try {
    do {
      const [nextCursor, keys] = await kv.scan(cursor, {
        match: "profile:*",
        count: 100,
      });
      cursor = nextCursor;

      if (keys.length > 0) {
        // Fetch all profiles in this batch
        const pipelines = kv.pipeline();
        keys.forEach((key) => pipelines.hgetall(key));
        const profiles = await pipelines.exec();

        profiles.forEach((profile, index) => {
          if (!profile) return;
          
          totalProfilesScanned++;
          const key = keys[index];
          const userId = key.replace("profile:", "");

          // Parse stats safely
          const swapCount = Number(profile.swapCount || 0);
          const swapVolume = Number(profile.swapVolume || 0);
          const lpProvided = Number(profile.lpProvided || 0);

          // Check criteria
          const isEarlySwaparcer =
            swapCount >= 100 ||
            swapVolume >= 10000 ||
            lpProvided >= 1000;

          if (isEarlySwaparcer) {
            earlySwaparcers.push({
              userId,
              username: profile.username || "Unknown",
              swapCount,
              swapVolume,
              lpProvided,
              walletAddress: profile.walletAddress || userId // fallback to ID if address missing
            });
          }
        });
      }
      
      process.stdout.write(`\rScanned ${totalProfilesScanned} profiles...`);
    } while (cursor !== 0 && cursor !== "0");

    console.log("\n");
    console.log("========================================");
    console.log(`Total Profiles Scanned: ${totalProfilesScanned}`);
    console.log(`Total EARLY SWAPARCERS Found: ${earlySwaparcers.length}`);
    console.log("========================================");

    if (earlySwaparcers.length > 0) {
      console.log("\nQualifying Users:");
      earlySwaparcers.forEach((user, i) => {
        const triggers = [];
        if (user.swapCount >= 100) triggers.push(`Swaps: ${user.swapCount}`);
        if (user.swapVolume >= 10000) triggers.push(`Vol: $${user.swapVolume.toFixed(2)}`);
        if (user.lpProvided >= 1000) triggers.push(`LP: $${user.lpProvided.toFixed(2)}`);

        console.log(
          `${i + 1}. [${user.username}] (${user.userId}) -> ${triggers.join(", ")}`
        );
      });
      
      console.log("\n========================================");
      console.log(`FINAL COUNT: ${earlySwaparcers.length} Early Swaparcers found.`);
    } else {
      console.log("No users meet the Early Swaparcer criteria yet.");
    }
    console.log("========================================");

  } catch (err) {
    console.error("Error scanning KV:", err);
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
