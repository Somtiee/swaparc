import {
  createCircleContractExecution,
  parseTokenAmount,
} from "../_circleUserApi.js";
import {
  assertNotExpired,
  assertReplayProtected,
  requestDigestHex,
  secureRandomHex,
} from "../../security/hardening.js";
import { assertRelayPoolAllowed } from "../../../lib/server/privpayRelayCore.js";

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

function normalizeCommitment(v) {
  const value = String(v || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("commitment must be bytes32 hex");
  }
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      userToken,
      walletId,
      privacyPoolAddress,
      commitment,
      amount,
      tokenAddress = ARC_USDC_ADDRESS,
      decimals = 6,
      feeLevel = "MEDIUM",
      idempotencyKey,
      requestTimestampMs,
      requestNonce,
      maxRequestAgeMs,
    } = req.body || {};

    if (
      !userToken ||
      !walletId ||
      !privacyPoolAddress ||
      !commitment ||
      amount == null
    ) {
      return res.status(400).json({
        error: "Missing required fields",
        details:
          "userToken, walletId, privacyPoolAddress, commitment, amount are required",
      });
    }

    assertRelayPoolAllowed(privacyPoolAddress);

    const amountUnits = parseTokenAmount(amount, Number(decimals));
    const normalizedCommitment = normalizeCommitment(commitment);
    const nonce = String(requestNonce || secureRandomHex(12));
    const ts = Number(requestTimestampMs || Date.now());
    const finalIdempotencyKey = String(idempotencyKey || secureRandomHex(16)).replace(
      /^0x/,
      ""
    );

    assertNotExpired({
      requestTimestampMs: ts,
      maxAgeMs: Number(maxRequestAgeMs || 2 * 60 * 1000),
    });
    const digest = requestDigestHex({
      walletId,
      privacyPoolAddress: String(privacyPoolAddress).toLowerCase(),
      tokenAddress: String(tokenAddress).toLowerCase(),
      commitment: normalizedCommitment.toLowerCase(),
      amountUnits,
      nonce,
      ts,
    });
    const replay = await assertReplayProtected({
      scope: "circle-privacy-pool-deposit",
      idempotencyKey: finalIdempotencyKey,
      digest,
      ttlSeconds: 15 * 60,
    });

    const execution = await createCircleContractExecution({
      userToken,
      walletId,
      contractAddress: privacyPoolAddress,
      abiFunctionSignature: "deposit(bytes32,uint256)",
      abiParameters: [normalizedCommitment, amountUnits],
      feeLevel,
      idempotencyKey: finalIdempotencyKey,
    });

    return res.status(200).json({
      ok: true,
      challengeId: execution.challengeId,
      transactionId: execution.transactionId || null,
      txRequest: {
        walletId,
        privacyPoolAddress,
        tokenAddress,
        commitment: normalizedCommitment,
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
      error: e?.message || "Privacy pool deposit failed",
      details: e?.details || null,
    });
  }
}
