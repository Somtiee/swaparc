import { kv } from "@vercel/kv";
import "dotenv/config";

const wallet = "0xED638d2de9E7b6E8D06514A161bb2cEFf28bfCDd"; // Case sensitive in variable, but key is lower
async function run() {
  console.log(`Starting debug for wallet: ${wallet}`);
  try {
    // 1. Check wallet mapping
    const walletKey = `wallet:${wallet.toLowerCase()}`;
    console.log(`Checking key: ${walletKey}`);
    const userId = await kv.get(walletKey);
    console.log(`Resolved userId: ${userId}`);

    if (userId) {
        // 2. Fetch profile
        const profileKey = `profile:${userId}`;
        console.log(`Fetching profile: ${profileKey}`);
        const data = await kv.hgetall(profileKey);
        console.log("KV Data:", JSON.stringify(data, null, 2));
    } else {
        // Fallback: Check direct profile (legacy)
        console.log("No userId mapping found. Checking direct profile...");
        const legacyKey = `profile:${wallet}`; // Try original casing
        const legacyData = await kv.hgetall(legacyKey);
        console.log(`Legacy Data (${legacyKey}):`, JSON.stringify(legacyData, null, 2));
    }

    console.log("Done");
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
