# Profile & system API

Profile and leaderboard routes use **Redis/KV** (`lib/server/kv.js`) unless noted. Responses are **JSON**. Treat profile keys and PII as sensitive in production.

**Related:** [PrivPay relay & API](api-reference-privpay.md), [Health](#get-apihealth) below.

This page sits under **Developers & operators** → **API reference** and describes the **profile**, **leaderboard**, **landing metrics**, and **health** surfaces most integrators touch first. Pair it with [Prerequisites & environment](../getting-started/prerequisites-and-environment.md) for **`REDIS_URL`** / Upstash wiring and with [PrivPay relay & API](api-reference-privpay.md) when a flow mixes public profile data with privacy-pool actions. Because **profile keys and PII** are sensitive in production, align route exposure with your edge auth, network boundaries and logging policies. This document describes handler behavior, not your hosting provider’s perimeter controls.

## Profile APIs

### `GET /api/profile/get`

Loads a profile hash from KV.

Callers pass **`userId`** as a **required** query parameter: it may be a **logical profile id** or a **`0x…` wallet address** depending on how the app keyed the user at creation time.

**Behavior**

- If **`userId` starts with `0x`**, the server uses **`profile:{lowercase}`** and may resolve **`wallet:{address}`** to a **legacy mapped profile key**, so the same human can appear under stable storage even when the client rotates casing or mixes “profile id” vs “wallet id” in the URL.
- **Badges are sanitized**; **`earlySwaparcer`** is enforced against a **frozen snapshot (`earlySwaparcerFrozen`)**, not arbitrary client flags (clients cannot mint prestige badges by posting crafted hash fields).

**Responses**

- **`200` + `{ success: true, profile }`** — profile fields are KV hash contents (e.g. **`username`**, **`avatar`**, **`walletAddress`**, **`swapCount`**, **`swapVolume`**, **`lpProvided`**, **`badges`**).
- **`200` + `{ success: false, message: "Profile not found" }`** — no row.
- **`500`** — server error.

### `POST /api/profile/save`

Upserts display and identity fields. **Does not** trust client-supplied **`swapCount`**, **`swapVolume`** or **`lpProvided`**; those are taken from the existing profile (defaults 0).

**Body (JSON)**

- **`userId`** (required)
- Optional: **`username`**, **`walletId`**, **`avatar`**, **`walletAddress`**
- The body **may include `swapCount`, `swapVolume`, `lpProvided`** — those values are **ignored for writes**; they are **kept from the existing record** so volume and LP aggregates cannot be forged through this upsert path.

**Responses**

- **`200` + `{ success: true }`**
- **`400`** — missing `userId`
- **`500`** — save failed

### `POST /api/profile/addSwap`

Increments swap stats and leaderboard sorted sets (used when the app records a swap for a profile).

**Body (JSON)**

- **`userId`** (required)
- **`amount`** (required) — numeric volume increment for **`swapVolume`**

**Behavior**

- If **`userId` is `0x…`**, the handler resolves **`wallet:{lower}`** to a **mapped profile id when present**, so leaderboard writes stay keyed consistently.
- **`swapCount` += 1**; **`swapVolume` += `amount`** (float increment).
- Updates **`leaderboard:swapCount`** and **`leaderboard:swapVolume`** for the **resolved member id**.

Callers should treat **`amount`** as the same units the UI uses for notional volume, because sorted-set scores ingest that float directly.

**Responses**

- **`200` + `{ success: true, newCount, newVolume }`**
- **`400`** — missing `userId` or `amount`
- **`500`** — error

### `POST /api/profile/updateIdentity`

Updates **`username`** and/or **`avatar`** for an existing profile.

**Body (JSON)**

- **`userId`** (required)
- **`username`**, **`avatar`** (optional; **omit a field to leave it unchanged** — useful when mobile clients only send the field the user touched)

**Responses**

- **`200` + `{ success: true, profile }`**
- **`400`** — missing `userId`
- **`404`** — profile not found
- **`500`** — error

### `POST /api/profile/updateLp`

Sets LP aggregate and leaderboard LP score.

**Body (JSON)**

- **`userId`** (required)
- **`lpTotalValue`** (required) — number; stored as **`lpProvided`**

**Responses**

- **`200` + success payload** (updates **`leaderboard:lpProvided`** when the value is positive)
- **`400`** — missing or invalid fields
- **`500`** — error

### `GET /api/profile/leaderboard`

Scans **`profile:*`**, aggregates totals, returns top slices.

**Response (`200`)** — example shape:

- **`topSwapVolume`**, **`topSwapCount`**, **`topLPProvided`** — arrays (up to **10** each), sorted **descending**
- **`totalSwapVolume`**, **`totalSwapCount`**, **`totalLP`**, **`uniqueUsers`** — scalars summarizing the scanned corpus

This route is heavier than a single-hash read because it walks keys; cache at the edge only if you accept slightly stale podium ordering.

**Errors**

- **`405`** — wrong method
- **`500`** — server error

### `GET /api/profile/landing-stats`

Cached landing-page metrics for the marketing/home experience.

**Sources (read-only, no `profile:*` SCAN on this route)**

- Precomputed KV keys: **`stats:countUniqueSwappers:last`**, **`stats:totalSwapVolume:last`** (updated by hourly cron — see below)
- Optional **Arclenz** `https://arclenz.xyz/api/ecosystem/swaparc`
- **File fallbacks** under **`data/stats/*.latest.json`**
- **High-water** key **`stats:landing:highwater:v1`** so displayed totals do not regress

**Cache:** **~15 minutes** in KV plus **`Cache-Control: public, s-maxage=900`** for the CDN. This keeps Railway Redis **egress** low when `REDIS_URL` points at Railway — see [Railway Redis egress](../operate/railway-redis-egress.md).

**Response:** **`200`** JSON with **`stats`**. Best-effort marketing telemetry, not a financial audit trail.

### `GET|POST /api/profile/refresh-landing-stats`

**Cron-only** (Vercel schedule **hourly**). Scans **`profile:*`**, writes the two precomputed stats keys above. Requires **`Authorization: Bearer <CRON_SECRET>`** when `CRON_SECRET` is set. Set **`STATS_CRON_DISABLE_PROFILE_SCAN=true`** to skip the scan in an egress emergency.

## Public leaderboard

### `GET /api/leaderboard/get`

Returns up to **100** profiles sorted by **swap volume** (descending). Each entry is **public fields only**:

- **`username`**
- **`avatar`**
- **`swapVolume`**
- **`badges`**

**Errors**

- **`405`**
- **`500`**

This is the intentionally narrow public surface: anything not listed here should be assumed **private** unless you expose another route—do not rely on obscurity for emails, wallet identifiers or raw KV ids.

## Health

### `GET /api/health`

Liveness probe only.

```json
{
  "status": "ok",
  "service": "swaparc-api"
}
```

**Operational caution:** This does **not** check Redis, RPC or the relayer wallet. Use separate monitors for dependencies and balances.

**Suggested monitors** (beyond this endpoint)

- **Redis latency** and error rate for profile/relay paths
- **Arc RPC** availability and error rate
- **Relayer native balance** and transaction success rate

Kubernetes or load balancers should still use **`/api/health`** for **process liveness** so incidents separate “app up” from “app useful.”

## Other routes

The `api/` tree also includes **payments** (bills, payroll, recurring), **Circle** user/enterprise executors, **auth**, **prices**, etc. For PrivPay-specific HTTP APIs, use [PrivPay relay & API](api-reference-privpay.md). Discover additional handlers by listing files under `api/` in the repository.
