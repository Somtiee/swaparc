import { kv } from "@vercel/kv";
// import { startIndexer } from "../indexers/swapIndexer.js";

// if (!globalThis.__swapIndexerStarted) {
//   globalThis.__swapIndexerStarted = true;
//   // startIndexer();
// }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  if (profile && profile.badges && typeof profile.badges === 'string') {
    try {
      profile.badges = JSON.parse(profile.badges);
    } catch (e) {}
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
}
