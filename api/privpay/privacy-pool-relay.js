import { ethers } from "ethers";
import {
  assertOptionalRelayServerSecret,
  assertRelayPoolAllowed,
  assertRelayRateLimit,
  relayChainId,
  relayClientIp,
  relayLogHint,
  verifyRelayDepositSignature,
  verifyRelayWithdrawSignature,
} from "../../lib/server/privpayRelayCore.js";

const MAX_PROOF_BYTES = 24 * 1024;

/**
 * PrivPay pool relayer: only `deposit` (via depositFor + depositor EIP-712) and `withdraw` (recipient EIP-712).
 *
 * Env:
 * - PRIVACY_POOL_RELAYER_PRIVATE_KEY — relayer EOA
 * - ARC_RPC_URL — required when VERCEL_ENV=production or NODE_ENV=production
 * - PRIVPAY_ALLOWED_POOL_ADDRESSES, or PRIVACY_POOL_ADDRESS, or VITE_PRIVACY_POOL_ADDRESS — allowlist (required)
 * - ARC_CHAIN_ID — default 5042002
 * - PRIVPAY_RELAY_RPM — per-IP requests per minute per action (default 30)
 * - PRIVPAY_RELAY_SERVER_SECRET (or legacy PRIVACY_POOL_RELAY_SERVER_SECRET) — optional; header X-Privpay-Relay-Secret
 * - PRIVPAY_RELAY_RL_PEPPER — optional salt for rate-limit key hashing
 *
 * POST JSON:
 * { "action": "withdraw" | "deposit", ... }
 *
 * withdraw: poolAddress, proof, nullifierHash, recipient, amount, deadline, signature
 * deposit: poolAddress, depositor, commitment, amount, deadline, signature
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.PRIVACY_POOL_RELAYER_PRIVATE_KEY || "";
  if (!key) {
    return res.status(503).json({ error: "Relay not configured" });
  }

  let action = "";
  let poolHint = "";

  try {
    const ip = relayClientIp(req);
    const body = req.body || {};
    action = String(body.action || "").toLowerCase();
    poolHint = String(body.poolAddress || "").trim();

    if (action !== "withdraw" && action !== "deposit") {
      return res.status(400).json({ error: 'Invalid action (use "withdraw" or "deposit")' });
    }

    // The optional server secret is primarily used to gate server-to-server
    // callers (recurring cron, back-office scripts) and `deposit` flows
    // where the server may sponsor gas without a strong on-chain
    // authorization path. Browser-initiated `withdraw` calls already prove
    // authorization cryptographically via EIP-712 (recipient signature)
    // plus nullifier-based replay protection, so requiring a shared
    // secret there adds no meaningful security while silently breaking
    // the browser's broadcast-failure fallback. We therefore enforce the
    // secret only when the action is NOT `withdraw`, or when the caller
    // explicitly opted in by sending the header (useful for server jobs
    // that want stricter scoping).
    const sentSecret = String(req.headers["x-privpay-relay-secret"] || "").trim();
    if (action !== "withdraw" || sentSecret) {
      assertOptionalRelayServerSecret(req);
    }

    await assertRelayRateLimit(ip, action);

    const chainId = relayChainId();
    const rpcRaw = String(process.env.ARC_RPC_URL || "").trim();
    const isProd =
      process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    if (!rpcRaw && isProd) {
      return res.status(503).json({ error: "ARC_RPC_URL not configured" });
    }
    const rpc = rpcRaw || "https://rpc.testnet.arc.network";
    const provider = new ethers.JsonRpcProvider(rpc);
    const relayer = new ethers.Wallet(key, provider);

    if (action === "withdraw") {
      const {
        poolAddress,
        proof,
        nullifierHash,
        recipient,
        amount,
        deadline,
        signature,
      } = body;

      if (
        !poolAddress ||
        proof == null ||
        proof === "" ||
        !nullifierHash ||
        !recipient ||
        amount == null ||
        deadline == null ||
        !signature
      ) {
        return res.status(400).json({
          error:
            "withdraw requires poolAddress, proof, nullifierHash, recipient, amount, deadline, signature",
        });
      }

      assertRelayPoolAllowed(poolAddress);

      let proofBytes;
      try {
        proofBytes = typeof proof === "string" ? ethers.getBytes(proof) : new Uint8Array(proof);
      } catch {
        return res.status(400).json({ error: "Invalid proof encoding" });
      }
      if (!proofBytes.length || proofBytes.length > MAX_PROOF_BYTES) {
        return res.status(400).json({ error: "Invalid proof" });
      }

      let amountWei;
      try {
        amountWei = BigInt(String(amount));
      } catch {
        return res.status(400).json({ error: "amount must be uint256" });
      }
      if (amountWei <= 0n) {
        return res.status(400).json({ error: "amount must be positive" });
      }

      let nh;
      try {
        nh = ethers.zeroPadValue(ethers.toBeHex(nullifierHash), 32);
      } catch {
        return res.status(400).json({ error: "Invalid nullifierHash" });
      }

      verifyRelayWithdrawSignature({
        poolAddress,
        chainId,
        nullifierHash: nh,
        recipient,
        amountWei,
        deadline,
        signature,
      });

      const abi = [
        "function withdraw(bytes proof, bytes32 nullifierHash, address recipient, uint256 amount) external",
        "function nullifierSpent(bytes32) view returns (bool)",
      ];
      const pool = new ethers.Contract(
        ethers.getAddress(poolAddress),
        abi,
        relayer
      );
      const spent = await pool.nullifierSpent(nh).catch(() => false);
      if (spent) {
        return res.status(409).json({
          ok: false,
          error:
            "This claim code was already used. Each payment can only be claimed once.",
          code: "NULLIFIER_SPENT",
        });
      }
      const tx = await pool.getFunction(
        "withdraw(bytes,bytes32,address,uint256)"
      )(proofBytes, nh, ethers.getAddress(recipient), amountWei);
      const rcpt = await tx.wait();

      return res.status(200).json({
        ok: true,
        txHash: tx.hash,
        status: rcpt?.status ?? null,
        relayer: relayer.address,
      });
    }

    /* deposit */
    const { poolAddress, depositor, commitment, amount, deadline, signature } = body;
    if (
      !poolAddress ||
      !depositor ||
      !commitment ||
      amount == null ||
      deadline == null ||
      !signature
    ) {
      return res.status(400).json({
        error:
          "deposit requires poolAddress, depositor, commitment, amount, deadline, signature",
      });
    }

    assertRelayPoolAllowed(poolAddress);

    let amountWei;
    try {
      amountWei = BigInt(String(amount));
    } catch {
      return res.status(400).json({ error: "amount must be uint256" });
    }
    if (amountWei <= 0n) {
      return res.status(400).json({ error: "amount must be positive" });
    }

    let comm;
    try {
      comm = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);
    } catch {
      return res.status(400).json({ error: "Invalid commitment" });
    }

    verifyRelayDepositSignature({
      poolAddress,
      chainId,
      depositor,
      commitment: comm,
      amountWei,
      deadline,
      signature,
    });

    const abi = [
      "function depositFor(address from, bytes32 commitment, uint256 amount) external",
    ];
    const pool = new ethers.Contract(
      ethers.getAddress(poolAddress),
      abi,
      relayer
    );
    const tx = await pool.depositFor(
      ethers.getAddress(depositor),
      comm,
      amountWei
    );
    const rcpt = await tx.wait();

    return res.status(200).json({
      ok: true,
      txHash: tx.hash,
      status: rcpt?.status ?? null,
      relayer: relayer.address,
    });
  } catch (e) {
    const status = Number(e?.status || 500);
    const hint = relayLogHint(action || "?", poolHint || "0x0");
    if (status >= 500 && process.env.PRIVPAY_RELAY_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error("[privpay-relay]", hint, e?.message || e);
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: e?.message || "Relay failed",
    });
  }
}
