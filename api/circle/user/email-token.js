export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Circle API key not configured" });
  }

  try {
    const { email, deviceId } = req.body || {};
    if (!email || !deviceId) {
      return res
        .status(400)
        .json({ error: "Missing email or deviceId" });
    }

    const idempotencyKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const response = await fetch(
      "https://api.circle.com/v1/w3s/users/email/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          idempotencyKey,
          email,
          deviceId,
        }),
      }
    );

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const circleStatus = response.status;
      const circleMessage =
        json?.error ||
        json?.message ||
        "Circle email token request failed";

      console.log(
        "Circle email token error:",
        "status",
        circleStatus,
        "message",
        circleMessage
      );

      return res.status(circleStatus).json({
        error: circleMessage,
        details: json,
      });
    }

    const data = json?.data || json || {};
    const { otpToken, deviceToken, deviceEncryptionKey } = data;

    return res.status(200).json({
      otpToken,
      deviceToken,
      deviceEncryptionKey,
    });
  } catch (err) {
    const message = err && err.message ? err.message : "Unknown error";
    console.error("Circle email token handler error:", message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
