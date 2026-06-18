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
    const { email, deviceId, otpToken } = req.body || {};
    if (!email || !deviceId || !otpToken) {
      return res.status(400).json({ error: "Missing email, deviceId, or otpToken" });
    }

    const idempotencyKey = crypto.randomUUID();
    const baseUrl = process.env.CIRCLE_BASE_URL || "https://api.circle.com";

    const response = await fetch(`${baseUrl}/v1/w3s/users/email/resendOTP`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        idempotencyKey,
        email,
        deviceId,
        otpToken,
      }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const circleMessage =
        json?.message || json?.error || "Circle OTP resend failed";
      console.error("[auth/resend-code] Circle error:", response.status, circleMessage);
      return res.status(response.status).json({
        error: circleMessage,
        details: json,
      });
    }

    const data = json?.data || json || {};
    const nextOtpToken = data?.otpToken || otpToken;

    return res.status(200).json({
      success: true,
      otpToken: nextOtpToken,
    });
  } catch (err) {
    console.error("Circle resend-code handler error:", err?.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
