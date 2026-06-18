export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("Missing CIRCLE_API_KEY in environment");
    return res.status(500).json({ error: "Server configuration error: Missing API Key" });
  }

  try {
    const { email, deviceId } = req.body || {};
    if (!email || !deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ error: "Missing email or deviceId" });
    }

    const idempotencyKey = crypto.randomUUID();
    const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";

    const response = await fetch(`${baseUrl}/v1/w3s/users/email/token`, {
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
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const circleMessage =
        json?.message || json?.error || "Circle email token request failed";
      console.error("[auth/send-code] Circle error:", response.status, circleMessage);
      return res.status(response.status).json({
        error: circleMessage,
        details: json,
      });
    }

    const data = json?.data || json || {};
    const { otpToken, deviceToken, deviceEncryptionKey } = data;

    if (!otpToken || !deviceToken || !deviceEncryptionKey) {
      console.error("[auth/send-code] Circle OK but missing tokens:", data);
      return res.status(502).json({
        error: "Circle did not return OTP session tokens. Try again in a minute.",
        details: data,
      });
    }

    return res.status(200).json({
      success: true,
      otpToken,
      deviceToken,
      deviceEncryptionKey,
    });
  } catch (err) {
    console.error("Circle send-code handler error:", err?.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
