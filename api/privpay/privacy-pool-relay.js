import { ethers } from "ethers";
import { getHealthyArcProvider, withArcRpc } from "../../lib/server/arcRpc.js";
import {
  sendRelayerContractTx,
  withRelayerTxLock,
} from "../../lib/server/recurringPrivpayExecution.js";
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
 * How long to wait for the tx receipt before answering. The API sits behind
 * proxies that cut connections around 30s; an unbounded `await tx.wait()`
 * died at the proxy while the tx kept flying — the client then retried into
 * "already claimed". On timeout we answer `pending: true` with the txHash and
 * let the client's receipt watcher confirm it.
 */
const RECEIPT_TIMEOUT_MS = Math.max(
  5000,
  Math.min(25000, Number(process.env.PRIVPAY_RELAY_RECEIPT_TIMEOUT_MS || 20000))
);

/** Wait for a receipt with a hard cap; resolves null on timeout. */
function waitReceiptCapped(tx) {
  return Promise.race([
    tx.wait().catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), RECEIPT_TIMEOUT_MS)),
  ]);
}

/**
 * PrivPay pool relayer: only `deposit` (via depositFor + depositor EIP-712) and `withdraw` (recipient EIP-712).
 *
 * Env:
 * - PRIVACY_POOL_RELAYER_PRIVATE_KEY — relayer EOA
 * - ARC_RPC_URL — optional extra Arc RPC; the relay binds to the first healthy
 *   endpoint (public Arc → dRPC → Alchemy last) via lib/server/arcRpc.js, the
 *   same failover chain used by swaps/LP/recurring. A single hard-coded
 *   ARC_RPC_URL binding made every pay-now deposit and claim fail whenever
 *   that one endpoint was rate-limited or down.
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
    // Bind the relayer to the first healthy Arc RPC (public + dRPC raced,
    // Alchemy last resort) instead of a single ARC_RPC_URL that takes the
    // whole pay-now/claim flow down when it 429s.
    const provider = await getHealthyArcProvider("privpay-relay");
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
      // Race the duplicate-claim check across the failover chain so a flaky
      // primary RPC cannot silently turn into `false` (which would push a
      // guaranteed-revert tx on-chain and waste relayer gas).
      const spent = await withArcRpc(
        async (p) => {
          const ro = new ethers.Contract(ethers.getAddress(poolAddress), abi, p);
          return ro.nullifierSpent(nh);
        },
        "relay-nullifierSpent",
        5000
      ).catch(() => false);
      if (spent) {
        return res.status(409).json({
          ok: false,
          error:
            "This claim code was already used. Each payment can only be claimed once.",
          code: "NULLIFIER_SPENT",
        });
      }
      // Serialize with the autopay cron (same relayer EOA, same nonce space)
      // and send with a fresh pending nonce — a claim racing a payroll run
      // used to collide on the nonce and hard-fail.
      const tx = await withRelayerTxLock(() =>
        sendRelayerContractTx(relayer, (overrides) =>
          pool.getFunction("withdraw(bytes,bytes32,address,uint256)")(
            proofBytes,
            nh,
            ethers.getAddress(recipient),
            amountWei,
            overrides
          )
        )
      );
      const rcpt = await waitReceiptCapped(tx);

      if (rcpt && rcpt.status === 0) {
        // Reverted: the nullifier was NOT spent, so the recipient can retry.
        return res.status(502).json({
          ok: false,
          error:
            "Claim transaction reverted on-chain. The payment was not spent — please retry the claim.",
          txHash: tx.hash,
          relayer: relayer.address,
        });
      }

      return res.status(200).json({
        ok: true,
        txHash: tx.hash,
        status: rcpt?.status ?? null,
        pending: !rcpt,
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
    const tx = await withRelayerTxLock(() =>
      sendRelayerContractTx(relayer, (overrides) =>
        pool.depositFor(ethers.getAddress(depositor), comm, amountWei, overrides)
      )
    );
    const rcpt = await waitReceiptCapped(tx);

    if (rcpt && rcpt.status === 0) {
      return res.status(502).json({
        ok: false,
        error:
          "Deposit transaction reverted on-chain. The deposit was not spent — please retry.",
        txHash: tx.hash,
        relayer: relayer.address,
      });
    }

    return res.status(200).json({
      ok: true,
      txHash: tx.hash,
      status: rcpt?.status ?? null,
      pending: !rcpt,
      relayer: relayer.address,
    });
  } catch (e) {
    const status = Number(e?.status || 500);
    const hint = relayLogHint(action || "?", poolHint || "0x0");
    // Always log 5xx (message only) — a silent 500 left no trace of why
    // claims were failing in production.
    if (status >= 500) {
      console.error("[privpay-relay]", hint, e?.message || e);
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: e?.message || "Relay failed",
    });
  }
}
