# PrivPay relay & API

This page documents PrivPay-related HTTP APIs used by SwapArc. For architecture context, see [Contracts & architecture](contracts-and-architecture.md).

It sits under **Developers & operators** → **API reference** and is the contract-facing companion to [Relayer operations](../operate/relayer-operations.md) and [Prerequisites & environment](../getting-started/prerequisites-and-environment.md), where relay keys, allowlists, RPM and KV toggles are defined. Read it together with [PrivPay private receive (ZK privacy pool)](../concepts/privpay-private-receive-zk.md) when you need the ZK story behind claim context and Merkle paths. Treat every route that touches key material or Merkle history as **security-sensitive**: validate callers, rotate secrets and never log raw proofs, signatures, or receiver blobs.

## `POST /api/privpay/privacy-pool-relay`

Relays privacy pool `deposit` (via `depositFor`) and `withdraw` transactions signed by a configured relayer EOA.

Operators run this endpoint when browsers or backend jobs should not hold the relayer’s hot key, but still need gas-sponsored or batched submission after the **user** (or an authorized server) has produced valid typed data. The handler’s job is not to “trust the client,” but to **re-verify** authorization, **constrain** which pools may be touched and **rate-limit** abuse before any `eth_sendRawTransaction` path executes.

### Request body

`Action` must be

`- Deposit` or 

`- Withdraw`.

#### Withdraw payload

```json
{
  "action": "withdraw",
  "poolAddress": "0x...",
  "proof": "0x...",
  "nullifierHash": "0x...",
  "recipient": "0x...",
  "amount": "1000000",
  "deadline": "1715000000",
  "signature": "0x..."
}
```

#### Deposit payload

```json
{
  "action": "deposit",
  "poolAddress": "0x...",
  "depositor": "0x...",
  "commitment": "0x...",
  "amount": "1000000",
  "deadline": "1715000000",
  "signature": "0x..."
}
```

Field semantics follow the on-chain pool: **`poolAddress`** must be an allowlisted deployment; **`amount`** is the integer string the pool expects for the token’s decimals; **`deadline`** is a Unix timestamp bound by server-side max skew; **`signature`** is the EIP-712 signature over the typed payload described later in this page. For **withdraw**, **`proof`** is the Groth16 proof bytes, **`nullifierHash`** is the spend tag and **`recipient`** is both the payout address and the **typed-data signer identity** the relay checks. For **deposit**, **`depositor`** funds through the relay path, **`commitment`** is the note commitment being inserted and the **signer must be the depositor**; never reuse payloads across users or pools without re-signing.

### Behavior

The route **requires `PRIVACY_POOL_RELAYER_PRIVATE_KEY`** so the relayer EOA can sign and broadcast. It **enforces a pool allowlist** via **`PRIVPAY_ALLOWED_POOL_ADDRESSES`** or the **derived pool env vars** your deployment maps server-side, so a crafted `poolAddress` cannot pivot the relayer to an attacker-controlled contract. It **verifies EIP-712 typed-data authorization** in **`lib/server/privpayRelayCore.js`**, keeping deposit and withdraw rules aligned and auditable in one module. It **applies per-IP per-action rate limiting** using **`PRIVPAY_RELAY_RPM`**, with optional persistence through **KV via `REDIS_URL` / Upstash** so distributed deployments do not reset buckets on every cold start.

### Optional relay secret header (`X-Privpay-Relay-Secret`)

If `PRIVPAY_RELAY_SERVER_SECRET` or legacy `PRIVACY_POOL_RELAY_SERVER_SECRET` is set:

| Request | Header required? |
|--------|-------------------|
| **`withdraw`** | **No**, if the client **omits** the header — authorization is still **EIP-712 (recipient)** plus on-chain proof/nullifier checks. If the client **sends** the header, it **must** match the secret. |
| **`deposit`** | **Yes** when a secret is configured — every deposit request must include a matching `X-Privpay-Relay-Secret`. |

This split keeps browser withdraw fallbacks working while still allowing operators to gate **deposit** and server-to-server callers.

From a security review perspective, treat the optional header as a **second factor for deposit** and as a **strict matcher for withdraw when present**: misconfigured clients that send the wrong header will fail closed with **`401`**, while honest browser withdraw flows that never learned the secret continue to rely on **recipient-bound EIP-712** and on-chain verification.

### Common responses

Common responses follow predictable semantics for automation. **`200`** returns `{ ok, txHash, status, relayer }`. **`400`** indicates invalid payload, amount, proof encoding/size, deadline (expired or too far). **`401`** indicates EIP-712 signature mismatch or secret mismatch when assertion runs. **`403`** indicates pool not allowlisted. **`429`** indicates rate limit exceeded. **`503`** indicates relay key missing, production `ARC_RPC_URL` missing, allowlist not configured or KV required but unavailable (`PRIVPAY_RELAY_REQUIRE_KV`).

Log and alert on **`503`** separately from **`400`**: the former often reflects misconfiguration or infrastructure outage, while the latter usually means a client bug or tampered request.

## `GET /api/privpay/claim-context`

Builds Merkle context for a given **commitment** in a **privacy pool** so the browser can construct a witness and Groth16 proof. Uses RPC log scans with optional KV caching.

This endpoint is read-heavy and **RPC-shaped**: it walks deposit history, reconstructs siblings and returns the vectors your proving code expects. It is safe to cache responses briefly at the edge only if you understand staleness—roots move as new deposits land and a witness built against an old root will fail verification on-chain.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `poolAddress` | Yes | Checksummed pool contract address. |
| `commitment` | Yes | `bytes32` commitment to locate in the deposit history. |
| `merkleHeight` | No | Default `16`; clamped between 16 and 32 in the handler. |
| `fromBlock` | No | Start block for scans; falls back to `PRIVPAY_POOL_FROM_BLOCK`, `VITE_PRIVACY_POOL_FROM_BLOCK` or `PRIVACY_POOL_FROM_BLOCK`. |

Callers should always pass **`poolAddress`** and **`commitment`** that came from the same user session that generated the note; mixing pools across tokens is a frequent source of **`404`** responses that look like “ZK is broken” when the history simply does not contain that leaf.

### Successful response (`200`)

```json
{
  "ok": true,
  "context": {
    "root": "0x...",
    "pathElements": ["0x...", "..."],
    "pathIsRight": [false, true],
    "leafIndex": 0,
    "depositCount": 0,
    "latestBlock": 0,
    "totalDeposits": 0
  }
}
```

The **`context`** object is what client-side witness code consumes: **`pathElements`** and **`pathIsRight`** define the Merkle siblings, **`leafIndex`** positions the commitment in the tree, and **`root`** must ultimately match what the pool considers canonical when the proof is verified.

### Other status codes

**`202`**: Scan in progress. Body includes `pending: true` and `progress` (partial block range). Client should retry.

**`404`**: Commitment not found in canonical history (wrong pool, wrong token, or stale code).

**`503`**: History incomplete, root mismatch after scan, or computed root not yet known on-chain — often transient; retry.

Clients should implement **bounded exponential backoff** on **`202`** and **`503`** rather than tight loops that amplify RPC load; combine that with UI copy that explains “indexing” so users do not abandon a valid claim.

### Environment tuning

Throughput for large histories is governed by **`PRIVPAY_CLAIM_CONTEXT_CHUNKS`**, the **max chunk ranges per request** (**default `120`**, **max `400`**) and by **`PRIVPAY_CLAIM_CONTEXT_CONCURRENCY`**, the **parallel `getLogs` batch size** (**default `8`**, **max `16`**). Raising concurrency without headroom on your RPC provider is a common way to trigger throttling that surfaces as **`503`** even when the commitment exists; tune in staging with realistic deposit depth before turning knobs in production.

## Relay EIP-712 summary

Typed data is what binds user intent to a specific pool and deadline without trusting the relay’s JSON parser alone. The **domain name** is **`PrivPayPoolRelay`**, the **version** is **`1`** and **`chainId`** comes **from the server** via **`ARC_CHAIN_ID` / `CHAIN_ID`**, **default `5042002`**. The **`verifyingContract`** is the **pool address** passed in the request body so signatures cannot be replayed across pools.

There are two primary types. **`RelayWithdraw`** covers:

**`- Pool`**

**`- NullifierHash`** 

**`- Recipient`** 

**`- Amount `** and

**`- Deadline`** 

the **signer must be `recipient`**. **`RelayDeposit`** covers;

**`- Pool`** 

**`- Depositor`** 

**`- Commitment`** 

**`- Amount`** and 

**`- Deadline`**. 

The **signer must be `depositor`**. Independently of field names, the **deadline must be in the future** and within **`PRIVPAY_RELAY_MAX_DEADLINE_SEC`** (**clamped 60–600s on the server**), which caps how long a captured signature remains useful if it leaks.

## Other PrivPay endpoints (summary)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/privpay/register-receiver` | POST | Store receiver key material (public keys and encrypted private key blobs) keyed by address for private-receive flows. |
| `/api/privpay/resolve` | GET | Resolve registered receiver public keys for an address. |
| `/api/privpay/backup-keys` | POST | Persist an encrypted keyring backup for an address (replay-protected request envelope). |
| `/api/privpay/recover-keys` | POST | Fetch a stored backup by `keyId` for an address. |
| `/api/privpay/list-backups` | GET | List backup metadata (`keyId`, labels, timestamps) for an address. |
| `/api/privpay/history/get` | GET | Load merged PrivPay history state for an `owner` address (bills, claims, resolved ids). |
| `/api/privpay/history/save` | POST | Merge and persist PrivPay history updates for an owner. |

Treat KV-backed receiver and backup payloads as **sensitive** operational data.

For these routes, apply the same discipline as for banking webhooks: authenticate the caller, encrypt data at rest per your deployment model, restrict admin access to KV namespaces and audit who can invoke **register**, **backup** and **recover** flows on behalf of an address.
