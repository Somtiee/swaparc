import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  const userId = `user_${Date.now()}`;

  const profile = {
    email,
    avatar: "",
    walletAddress: "",
    swapVolume: 0,
    swapCount: 0,
    lpProvided: 0,
    badges: {}
  };

  await kv.set(`profile:${userId}`, profile);

  res.status(200).json({
    success: true,
    userId,
    email
  });
}
