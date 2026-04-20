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

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

function normalizeViewTag(v) {
  const value = String(v || "").trim();
  if (!/^0x[0-9a-fA-F]{2}$/.test(value)) {
    throw new Error("viewTag must be 1-byte hex like 0xab");
  }
  return value;
}

function normalizeMetadataHash(v) {
  const value = String(v || "").trim();
  if (!value) throw new Error("metadataHash is required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("metadataHash must be bytes32 hex");
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
      stealthPaymentsAddress,
      stealthAddress,
      amount,
      tokenAddress = ARC_USDC_ADDRESS,
      decimals = 6,
      ephemeralPubKey,
      viewTag,
      metadataHash,
      feeLevel = "MEDIUM",
      idempotencyKey,
      requestTimestampMs,
      requestNonce,
      maxRequestAgeMs,
    } = req.body || {};

    if (
      !userToken ||
      !walletId ||
      !stealthPaymentsAddress ||
      !stealthAddress ||
      amount == null ||
      !ephemeralPubKey ||
      !viewTag ||
      !metadataHash
    ) {
      return res.status(400).json({
        error: "Missing required fields",
        details:
          "userToken, walletId, stealthPaymentsAddress, stealthAddress, amount, ephemeralPubKey, viewTag, metadataHash are required",
      });
    }

    const amountUnits = parseTokenAmount(amount, Number(decimals));
    const normalizedViewTag = normalizeViewTag(viewTag);
    const nonce = String(requestNonce || secureRandomHex(12));
    const ts = Number(requestTimestampMs || Date.now());
    const finalIdempotencyKey = String(idempotencyKey || secureRandomHex(16)).replace(
      /^0x/,
      ""
    );

    // Expiry + anti-replay on server side.
    assertNotExpired({
      requestTimestampMs: ts,
      maxAgeMs: Number(maxRequestAgeMs || 2 * 60 * 1000),
    });
    const digest = requestDigestHex({
      walletId,
      stealthPaymentsAddress: String(stealthPaymentsAddress).toLowerCase(),
      tokenAddress: String(tokenAddress).toLowerCase(),
      stealthAddress: String(stealthAddress).toLowerCase(),
      amountUnits,
      ephemeralPubKey,
      viewTag: normalizedViewTag,
      nonce,
      ts,
    });
    const replay = await assertReplayProtected({
      scope: "circle-stealth-payment",
      idempotencyKey: finalIdempotencyKey,
      digest,
      ttlSeconds: 15 * 60,
    });

    // Require explicit metadata hash from caller for deterministic parity with wallet flow.
    const normalizedMetadataHash = normalizeMetadataHash(metadataHash);

    const execution = await createCircleContractExecution({
      userToken,
      walletId,
      contractAddress: stealthPaymentsAddress,
      abiFunctionSignature:
        "announceERC20Payment(address,address,uint256,bytes,bytes1,bytes32)",
      abiParameters: [
        tokenAddress,
        stealthAddress,
        amountUnits,
        ephemeralPubKey,
        normalizedViewTag,
        normalizedMetadataHash,
      ],
      feeLevel,
      idempotencyKey: finalIdempotencyKey,
    });

    return res.status(200).json({
      ok: true,
      challengeId: execution.challengeId,
      transactionId: execution.transactionId || null,
      txRequest: {
        walletId,
        stealthPaymentsAddress,
        tokenAddress,
        stealthAddress,
        amount,
        amountUnits,
        decimals: Number(decimals),
        ephemeralPubKey,
        viewTag: normalizedViewTag,
        metadataHash: normalizedMetadataHash,
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
      error: e?.message || "Stealth payment execution failed",
      details: e?.details || null,
    });
  }
}

