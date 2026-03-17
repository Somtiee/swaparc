export default async function handler(req, res) {
  console.log(">>> [api/auth/send-code] RECEIVED REQUEST");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  const appId = process.env.VITE_CIRCLE_APP_ID;

  if (!apiKey) {
    console.error("Missing CIRCLE_API_KEY in environment");
    return res.status(500).json({ error: "Server configuration error: Missing API Key" });
  }

  try {
    const { email, deviceId } = req.body || {};
    if (!email || !deviceId || typeof deviceId !== "string") {
      console.warn("Missing email or deviceId in request body");
      return res
        .status(400)
        .json({ error: "Missing email or deviceId" });
    }

    console.log("[Circle API] send-code request:", { email, deviceId });

    const idempotencyKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const response = await fetch(
      "https://api.circle.com/v1/w3s/users/email/token",
      {
        method: "POST",
        headers,
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
        "Circle email token error (auth/send-code):",
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
      success: true,
      otpToken,
      deviceToken,
      deviceEncryptionKey,
    });
  } catch (err) {
    const message = err && err.message ? err.message : "Unknown error";
    console.error("Circle send-code handler error:", message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
