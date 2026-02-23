export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const { userToken } = req.body || {};
    if (!userToken) {
      return res.status(400).json({ error: "Missing userToken" });
    }

    const baseUrl =
      process.env.CIRCLE_BASE_URL || "https://api.circle.com";

    const response = await fetch(
      `${baseUrl}/v1/w3s/user/initialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-User-Token": userToken,
        },
        body: JSON.stringify({
          idempotencyKey:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
        }),
      }
    );

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        json?.error ||
        json?.message ||
        "Circle user initialization failed";
      return res.status(response.status).json({ error: msg });
    }

    const data = json?.data || json || {};
    const { challengeId } = data;

    return res.status(200).json({ challengeId });
  } catch (err) {
    const message = err && err.message ? err.message : "Unknown error";
    console.error("Circle user initialize handler error:", message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

