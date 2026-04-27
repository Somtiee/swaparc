import { kv } from "../../lib/server/kv.js";
// import { startIndexer } from "../indexers/swapIndexer.js";

function sanitizeBadges(raw) {
  if (!raw) return {};
  let obj = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === true || v === "true") out[k] = true;
  }
  return out;
}

// if (!globalThis.__swapIndexerStarted) {
//   globalThis.__swapIndexerStarted = true;
//   // startIndexer();
// }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = req.query;

    let key = `profile:${userId}`;
    if (userId && userId.startsWith("0x")) {
      const lower = userId.toLowerCase();
      // Prefer wallet-based key
      key = `profile:${lower}`;
      // Fallback to mapped legacy ID if wallet profile missing
      const mapped = await kv.get(`wallet:${lower}`);
      const walletProfile = await kv.hgetall(key);
      if (!walletProfile && mapped) {
        key = `profile:${mapped}`;
      }
    }

    const profile = await kv.hgetall(key);

    if (profile) {
      profile.badges = sanitizeBadges(profile.badges);
    }

    if (!profile) {
      return res.status(200).json({
        success: false,
        message: "Profile not found"
      });
    }

    return res.status(200).json({
      success: true,
      profile
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
