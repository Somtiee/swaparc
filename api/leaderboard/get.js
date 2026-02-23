import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let allProfiles = [];
    let cursor = 0;

    // Scan all profile keys
    do {
        const [nextCursor, keys] = await kv.scan(cursor, { match: 'profile:*', count: 100 });
        cursor = nextCursor;

        if (keys.length > 0) {
            const values = await kv.mget(...keys);
            keys.forEach((key, index) => {
                if (values[index]) {
                    allProfiles.push(values[index]);
                }
            });
        }
    } while (cursor !== 0 && cursor !== "0");

    // Sort by swapVolume descending
    allProfiles.sort((a, b) => (Number(b.swapVolume) || 0) - (Number(a.swapVolume) || 0));

    // Take top 100
    const top100 = allProfiles.slice(0, 100);

    // Map to public fields only
    const result = top100.map(p => ({
        username: p.username,
        avatar: p.avatar,
        swapVolume: Number(p.swapVolume) || 0,
        badges: p.badges || {}
    }));

    return res.status(200).json(result);

  } catch (error) {
    console.error("Leaderboard error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
