import { createCircleTransferChallenge } from "../_circleUserApi.js";
import {
  assertNotExpired,
  assertReplayProtected,
  requestDigestHex,
  secureRandomHex,
} from "../../security/hardening.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const {
      userToken,
      walletId,
      to,
      amountNative,
      feeLevel = "MEDIUM",
      idempotencyKey,
      requestTimestampMs,
      requestNonce,
    } = req.body || {};

    if (!userToken || !walletId || !to || amountNative == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields",
        details: "userToken, walletId, to, amountNative are required",
      });
    }

    const finalIdempotencyKey = String(idempotencyKey || secureRandomHex(16)).replace(/^0x/, "");
    const nonce = String(requestNonce || secureRandomHex(12));
    const ts = Number(requestTimestampMs || Date.now());

    assertNotExpired({ requestTimestampMs: ts, maxAgeMs: 2 * 60 * 1000 });
    const digest = requestDigestHex({
      walletId,
      to: String(to).toLowerCase(),
      amountNative: String(amountNative),
      nonce,
      ts,
    });
    const replay = await assertReplayProtected({
      scope: "circle-native-transfer",
      idempotencyKey: finalIdempotencyKey,
      digest,
      ttlSeconds: 10 * 60,
    });

    const execution = await createCircleTransferChallenge({
      userToken,
      walletId,
      destinationAddress: to,
      amount: String(amountNative),
      feeLevel,
      idempotencyKey: finalIdempotencyKey,
    });

    return res.status(200).json({
      ok: true,
      challengeId: execution.challengeId,
      transactionId: execution.transactionId || null,
      txRequest: {
        walletId,
        to,
        amountNative: String(amountNative),
        feeLevel,
      },
      security: {
        idempotencyKey: finalIdempotencyKey,
        requestNonce: nonce,
        requestDigest: digest,
        replayKey: replay.replayKey,
      },
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      ok: false,
      error: e?.message || "Native transfer execution failed",
      details: e?.details || null,
    });
  }
}

