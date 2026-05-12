# Relayer operations

This guide covers production operation of the PrivPay relay endpoint.

It is for **developers and operators** under **Security & operations** who own live traffic, secrets and RPC capacity. Pair it with [PrivPay relay & API](../build/api-reference-privpay.md) for request bodies and status semantics, [Key management and backups](../security-and-privacy/key-management-and-backups.md) for how the relayer key should live, [Threat model](../security-and-privacy/threat-model.md) for abuse assumptions and [Prerequisites & environment](../getting-started/prerequisites-and-environment.md) for full `.env` context.

## Endpoint

The relay exposes a single HTTP entrypoint: **`POST /api/privpay/privacy-pool-relay`**. It accepts **`deposit`** and **`withdraw`** actions; each path has different typed-data expectations and optional header rules, but both share the same URL and rate-limit buckets per client identity.

## Required configuration

Production relaying **requires `PRIVACY_POOL_RELAYER_PRIVATE_KEY`** so the server can sign and broadcast pool transactions after authorization checks pass. **`ARC_RPC_URL`** is **required in production runtime** so the handler can read chain state, simulate and submit against the same Arc network your pools are deployed on; missing RPC in production typically surfaces as **`503`** rather than a clean client error.

The relay will not safely operate without a **pool allowlist** that matches what you actually deployed. Configure it via **`PRIVPAY_ALLOWED_POOL_ADDRESSES`**, or via **per-token pool vars / fallback pool vars** (the same mapping your server jobs use for recurring flows). Drift between allowlist and live pool addresses is a common cause of **`403`** for legitimate users while attackers probing random pools still get nothing useful.

## Throughput and safety controls

**`PRIVPAY_RELAY_RPM`** caps **per-IP per-action** request volume so a single client cannot burn relayer gas or spam signature verification. **`PRIVPAY_RELAY_MAX_DEADLINE_SEC`** bounds how far in the future a relay authorization may remain valid, shrinking the window where a leaked signature is useful. **`PRIVPAY_RELAY_RL_PEPPER`** is the **hash salt for rate-limit keys** so different deployments do not share predictable bucket identifiers if templates match. **`PRIVPAY_RELAY_REQUIRE_KV`** makes the relay **fail closed if KV is unavailable**; use this when in-memory fallback is unacceptable for your compliance story. **`PRIVPAY_RELAY_DEBUG`** toggles **sanitized debug logging**; keep it off in steady state unless you are actively investigating a bounded incident.

## Optional secret gate

If **`PRIVPAY_RELAY_SERVER_SECRET`** is set:

- Deposit requests must include `X-Privpay-Relay-Secret`.
- Withdraw requests require it only when the header is present, otherwise EIP-712 + on-chain checks remain the primary authorization path.

That split preserves browser withdraw flows that never learned the secret while still forcing deposit callers through an extra shared secret when you have enabled one.

## Daily operator checklist

1. Confirm relayer wallet balance and nonce health.
2. Verify pool allowlist matches deployed pools.
3. Check 4xx/5xx trends and rate-limit spikes.
4. Spot-check successful withdraw confirmations.
5. Verify no unauthorized config drift.

Treat items 1–2 as **hard gates** before any marketing push or partner integration window; items 3–5 catch slow burns (bad deploy, creeping misconfig, or abuse) that volume dashboards alone miss.

## Incident triggers

- Sustained `503` responses.
- Unexpected `401` signature mismatches.
- Rising `429` that impacts normal traffic.
- Repeated claim failures tied to root/proof mismatch.

When any trigger fires, narrow the blast radius first (pause new traffic at the edge if needed), then compare recent config and artifact deploys against the last known-good release before you chase “chain issues” in isolation.
