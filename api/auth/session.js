import { circleUserRequest } from "../circle/_circleUserApi.js";
import { assertIpRateLimit } from "../security/walletAuth.js";
import {
  createSwaparcSession,
  getSwaparcSession,
  revokeSwaparcSession,
  touchSwaparcSession,
  isValidSessionId,
} from "../../lib/server/swaparcSessions.js";

/**
 * SwapArc persistent sessions for email (Circle) users.
 *
 *   POST   { userToken, email }  -> mints a session bound to the Circle wallet
 *   GET    ?sessionId=...        -> restore (no Circle round-trip)
 *   DELETE { sessionId }         -> revoke on explicit disconnect
 *
 * Sessions live in KV until disconnected — see lib/server/swaparcSessions.js.
 */
export default async function handler(req, res) {
  const sessionIdHeader = String(req.headers["x-session-id"] || "").trim();
  const body = req.body || {};

  try {
    if (req.method === "POST") {
      await assertIpRateLimit(req, "session-create", 10);
      const { userToken, email } = body;
      if (!userToken) {
        return res.status(400).json({ error: "Missing userToken" });
      }

      const data = await circleUserRequest({
        path: "/v1/w3s/wallets",
        method: "GET",
        userToken,
      });
      const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
      const wallet = wallets.find((w) => w?.address) || null;
      if (!wallet) {
        return res.status(400).json({ error: "No Circle wallet on this account" });
      }

      const record = await createSwaparcSession({
        owner: wallet.address,
        walletId: wallet.id,
        blockchain: wallet.blockchain,
        email: String(email || body.userEmail || "").trim(),
      });

      return res.status(200).json({
        sessionId: record.sessionId,
        address: record.owner,
        walletId: record.walletId,
        blockchain: record.blockchain,
        email: record.email,
      });
    }

    if (req.method === "GET") {
      const sessionId = String(req.query?.sessionId || sessionIdHeader || "").trim();
      const record = await getSwaparcSession(sessionId);
      if (!record) {
        return res.status(404).json({ error: "Session not found" });
      }
      // Roll the inactivity window so a regularly used session never expires.
      await touchSwaparcSession(sessionId);
      return res.status(200).json({
        address: record.owner,
        walletId: record.walletId,
        blockchain: record.blockchain,
        email: record.email,
      });
    }

    if (req.method === "DELETE") {
      await assertIpRateLimit(req, "session-revoke", 20);
      const sessionId = String(body.sessionId || sessionIdHeader || "").trim();
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: "Missing or invalid sessionId" });
      }
      const revoked = await revokeSwaparcSession(sessionId);
      return res.status(200).json({ success: true, revoked });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    const status = Number(err?.status) || 500;
    const message = err?.message || "Session error";
    console.error("Session handler error:", message);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}
