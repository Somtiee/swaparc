import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, username, avatar } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    const normalizedId = userId.startsWith("0x") ? userId.toLowerCase() : userId;
    const profileKey = `profile:${normalizedId}`;
    const existingProfile = await kv.hgetall(profileKey);

    if (!existingProfile) {
        return res.status(404).json({ error: 'Profile not found' });
    }

    const updatedProfile = {
      ...existingProfile,
      username: username !== undefined ? username : existingProfile.username,
      avatar: avatar !== undefined ? avatar : existingProfile.avatar
    };

    await kv.hset(profileKey, updatedProfile);

    return res.status(200).json({ 
        success: true, 
        profile: updatedProfile 
    });

  } catch (error) {
    console.error("Update identity error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
