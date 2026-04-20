import { createCircleContractExecution, parseTokenAmount } from "../_circleUserApi.js";
import {
  assertNotExpired,
  assertReplayProtected,
  requestDigestHex,
  secureRandomHex,
} from "../../security/hardening.js";

// ARC testnet USDC used in SwapArc.
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      userToken,
      walletId,
      to,
      amount,
      tokenAddress = ARC_USDC_ADDRESS,
      decimals = 6,
      feeLevel = "MEDIUM",
      idempotencyKey,
      requestTimestampMs,
      requestNonce,
    } = req.body || {};

    if (!userToken || !walletId || !to || amount == null) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "userToken, walletId, to, amount are required",
      });
    }

    const amountUnits = parseTokenAmount(amount, Number(decimals));
    const finalIdempotencyKey = String(idempotencyKey || secureRandomHex(16)).replace(
      /^0x/,
      ""
    );
    const nonce = String(requestNonce || secureRandomHex(12));

    assertNotExpired({
      requestTimestampMs: requestTimestampMs || Date.now(),
      maxAgeMs: 2 * 60 * 1000,
    });
    const digest = requestDigestHex({
      walletId,
      to: String(to).toLowerCase(),
      tokenAddress: String(tokenAddress).toLowerCase(),
      amountUnits,
      nonce,
      ts: Number(requestTimestampMs || Date.now()),
    });
    const replay = await assertReplayProtected({
      scope: "circle-usdc-transfer",
      idempotencyKey: finalIdempotencyKey,
      digest,
      ttlSeconds: 10 * 60,
    });

    const execution = await createCircleContractExecution({
      userToken,
      walletId,
      contractAddress: tokenAddress,
      abiFunctionSignature: "transfer(address,uint256)",
      abiParameters: [to, amountUnits],
      feeLevel,
      idempotencyKey: finalIdempotencyKey,
    });

    return res.status(200).json({
      ok: true,
      challengeId: execution.challengeId,
      txRequest: {
        walletId,
        tokenAddress,
        to,
        amount,
        amountUnits,
        decimals: Number(decimals),
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
      error: e?.message || "USDC transfer execution failed",
      details: e?.details || null,
    });
  }
}

