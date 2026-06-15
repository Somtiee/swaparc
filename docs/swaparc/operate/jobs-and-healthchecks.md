# Jobs & health checks

This document is for **developers and operators** under **Security & operations** who run SwapArc in production and need a minimal map of **liveness**, **scheduled work** and **what to watch**. It complements [Relayer operations](relayer-operations.md) for the privacy-pool relay path and [Profile & system API](../build/api-reference-profile-and-system.md) for the **`GET /api/health`** response shape. Remember that **`/api/health`** does not prove Redis, RPC, or relayer health by itself; pair it with the monitors below.

## Health endpoint

Use **`GET /api/health`**. Expected response indicates service liveness.

Call it from your load balancer or orchestrator as a **process-up** check only; route deeper dependency checks through the metrics and alerts in the monitoring sections so you do not confuse “HTTP 200” with “payments and relay are healthy.”

## Scheduled jobs

SwapArc uses scheduled payment processing routes, including recurring and payroll runs, plus a **weekly** landing-stats refresh.

| Route | Schedule (typical) | Purpose |
|-------|-------------------|---------|
| `/api/payments/recurring/run` | Every 5 min | Recurring bills |
| `/api/payments/payroll/run` | Every 5 min | Payroll queue |
| `/api/profile/refresh-landing-stats` | Weekly (`0 0 * * 0`, Sunday UTC) | SCAN `profile:*` once, update Redis aggregates, publish `landing-network.json` to Vercel Blob |

### Landing stats (production)

- **Homepage** loads network totals from **`VITE_LANDING_STATS_URL`** (public Vercel Blob JSON) — **no Railway Redis** on page load.
- **TVL** on the landing tab refreshes from on-chain RPC about every 60 seconds.
- **Swap pool cutover:** legacy pool stats are frozen; **V2 swaps add** to existing `profile:*` totals and weekly highwater (no reset). Run `node scripts/countUniqueSwappers.js` after cutover to merge legacy + V2 Arcscan counts into `stats:countUniqueSwappers:last`.
- **Real-time profile stats:** run `npm run indexer` (`liveSwapIndexer.js`) on Railway with `REDIS_URL` — tails V2 pool only.
- **Blob store must be Public** at creation (private stores cannot host the browser-facing JSON).
- Env: `BLOB_READ_WRITE_TOKEN` (server), `VITE_LANDING_STATS_URL` (build-time), optional `SWAP_POOL_ADDRESS` (defaults to V2 in code). Manual publish: `npm run stats:publish-landing`.
- Legacy APIs `GET /api/profile/landing-stats` and `GET /api/profile/leaderboard` remain scan-free fallbacks with long cache TTL.

If **`REDIS_URL`** is Railway-hosted, avoid polling those APIs from the landing page; the weekly cron is the only full profile scan.

### Railway swap indexer (V2 stats)

Run the **swaparc** service on Railway with:

| Setting | Value |
|---------|--------|
| **Start command** | `npm run start:railway` (or use repo `railway.toml` / `Procfile`) |
| **REDIS_URL** | From your Railway Redis service |
| **ARC_RPC_URL** | `https://rpc.testnet.arc.network` |
| **SWAP_POOL_ADDRESS** | Optional — defaults to V2 proxy in code |

On **first deploy**, a background job may backfill historical V2 swaps into `profile:*` (one-time). The **live indexer starts immediately** and tails new V2 **`Swapped` events via RPC** — it does not wait for the backfill or legacy-pool scan (those can take hours).

Optional env: `RAILWAY_SKIP_BOOTSTRAP=1` to skip the one-time backfill.

### Cron behavior

Cron schedules are defined in deployment config. If `CRON_SECRET` is set, cron requests must include:

- `Authorization: Bearer <CRON_SECRET>`

Treat **`CRON_SECRET`** like any other bearer token: rotate it when people leave, never log it, and reject requests that omit the header when the secret is configured; otherwise your cron URLs become unauthenticated triggers.

### Execution guard

`RECURRING_SERVER_EXECUTION_ENABLED` must be `true` for server-side recurring execution.

Without that guard, scheduled HTTP hits may return success at the edge while **no** server-side bill or payroll execution runs; confirm env parity between **preview**, **staging** and **production** after every deploy.

## Production monitoring recommendations

Track **job invocation success/failure rates** so silent partial failures (HTTP 200 with no work done) do not hide behind aggregate uptime. Track **queue depth or backlog** where available so you catch growing delay before users notice missed runs. **Alert on repeated relay submission failures** because they often precede gas, nonce, or allowlist incidents. **Alert on Redis/KV connectivity degradation** because profile, relay rate limits and payment state often depend on the same datastore tier.

## Minimum operational dashboard

- API liveness (`/api/health`).
- Relay response codes by action.
- Cron run status and duration.
- RPC request errors/timeouts.
- Redis/KV error rate.

Together these five views separate “app process alive” from “economic and scheduling paths working.” If you can only add one panel after **`/api/health`**, prioritize **relay codes by action** and **cron duration**; they correlate fastest with user-visible PrivPay and recurring payment breakage.
