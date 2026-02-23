import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // scan for all profiles
    let cursor = 0;
    const profiles = [];

    do {
        const [nextCursor, keys] = await kv.scan(cursor, { match: 'profile:*', count: 100 });
        cursor = nextCursor;

        if (keys.length > 0) {
            const values = await kv.mget(...keys);
            keys.forEach((key, index) => {
                if (values[index]) {
                    profiles.push({
                        userId: key.replace('profile:', ''),
                        ...values[index]
                    });
                }
            });
        }
    } while (cursor !== 0 && cursor !== "0");

    // Sort logic
    const topSwapVolume = [...profiles].sort((a, b) => (Number(b.swapVolume) || 0) - (Number(a.swapVolume) || 0)).slice(0, 10);
    const topSwapCount = [...profiles].sort((a, b) => (Number(b.swapCount) || 0) - (Number(a.swapCount) || 0)).slice(0, 10);
    const topLPProvided = [...profiles].sort((a, b) => (Number(b.lpProvided) || 0) - (Number(a.lpProvided) || 0)).slice(0, 10);

    return res.status(200).json({
        topSwapVolume,
        topSwapCount,
        topLPProvided
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
