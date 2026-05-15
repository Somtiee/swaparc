import { kv } from "../../lib/server/kv.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const ranked = await kv.zrevrange("leaderboard:swapVolume", 0, 99, { withScores: true });
    if (!ranked.length) {
      return res.status(200).json([]);
    }
    const profiles = await kv.mget(...ranked.map((r) => `profile:${r.member}`));
    const result = ranked.map((row, index) => {
      const p = profiles[index] || {};
      const badges =
        typeof p.badges === "string"
          ? (() => {
              try {
                return JSON.parse(p.badges);
              } catch {
                return {};
              }
            })()
          : p.badges || {};
      return {
        username: p.username,
        avatar: p.avatar,
        swapVolume: row.score,
        badges,
      };
    });
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=60");
    return res.status(200).json(result);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
