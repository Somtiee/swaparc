import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, amount } = req.body;

  if (!userId || amount == null) {
    return res.status(400).json({ error: "Missing userId or amount" });
  }

  try {
    let profileKey = `profile:${userId}`;

    if (userId.startsWith("0x")) {
      const lowerWallet = userId.toLowerCase();
      const mappedId = await kv.get(`wallet:${lowerWallet}`);
      profileKey = mappedId ? `profile:${mappedId}` : `profile:${lowerWallet}`;
    }

    return res.status(200).json({ success: true });

    /*
    // Fetch LP to evaluate badge
    const profile = await kv.hgetall(profileKey);
    ...
    */
  } catch (error) {
    console.error("Error adding swap:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
