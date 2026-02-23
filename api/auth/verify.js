export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const { userToken, encryptionKey, email } = req.body || {};
    if (!userToken || !encryptionKey) {
      return res
        .status(400)
        .json({ error: "Missing userToken or encryptionKey" });
    }

    const baseUrl =
      process.env.CIRCLE_BASE_URL || "https://api.circle.com";

    const response = await fetch(`${baseUrl}/v1/w3s/wallets`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-User-Token": userToken,
      },
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        json?.error ||
        json?.message ||
        "Circle token verification failed";
      return res.status(response.status).json({ error: msg });
    }

    return res.status(200).json({
      success: true,
      email: email || null,
      userToken,
      encryptionKey,
    });
  } catch (err) {
    const message = err && err.message ? err.message : "Unknown error";
    console.error("Circle verify handler error:", message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
