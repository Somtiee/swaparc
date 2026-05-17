# Railway Redis egress and landing stats

## Why a $5 plan can show a $50+ bill

Railway **Hobby** includes about **$5/month of usage credit**. Above that, you pay for what you use — especially **egress** (data leaving Railway’s network).

If **Redis runs on Railway** and **Vercel** connects with a public `REDIS_URL`, then **every read** of profile data from Vercel counts as **Railway egress**, billed per GB (on the order of **$0.05/GB**).

A full scan of all `profile:*` keys pulls **every profile** out of Redis on each request. That is fine at small scale and catastrophic at traffic scale.

## What caused the spike (SwapArc)

Several patterns compounded:

1. **`/api/profile/leaderboard`** (homepage) **SCAN + MGET all `profile:*` on every call**, polled **every 60 seconds** on the landing tab — often the largest egress source.

2. **`/api/profile/landing-stats`** used to **SCAN all profiles** on cache misses (fixed in an earlier deploy).

3. **`/api/profile/refresh-landing-stats`** cron scanned all profiles on a schedule (now **once per week**; set `STATS_CRON_DISABLE_PROFILE_SCAN=true` to stop entirely).

Together this can reach **hundreds of GB of egress** in a billing cycle.

## What we changed (fix)

| Change | Effect |
|--------|--------|
| **leaderboard** uses Redis **sorted sets** + top-10 profile reads only (no `profile:*` SCAN) | Stops the 60s homepage poll from exporting the whole DB |
| **landing-stats** no longer scans `profile:*` | Hot path only reads small precomputed keys + high-water marks |
| **Static `/stats/landing-network.json`** (weekly cron) | Landing loads **zero Railway Redis** for stats/leaderboard |
| **Response cache 7 days** + CDN `Cache-Control` | Legacy API fallback only |
| **Landing TVL** polls on-chain RPC every **60s** | Live TVL; not Railway |
| **Cron schedule once weekly** (`0 0 * * 0`, Sunday UTC) | One profile scan per week |
| **`STATS_CRON_DISABLE_PROFILE_SCAN=true`** | Emergency stop for the cron scan only |

Precomputed keys (written by the weekly cron):

- `stats:countUniqueSwappers:last`
- `stats:totalSwapVolume:last`

## How the layers fit together (plain English)

Think of **four layers** — only the **weekly cron** does the expensive “read every profile” work.

| Layer | What it is | Typical interval | Railway cost |
|-------|------------|------------------|--------------|
| **Stats cron** | Background job writes precomputed totals into Redis | **Once per week** | **High once/week** (one full scan) |
| **Static JSON** (`/stats/landing-network.json`) | Weekly cron writes file (+ optional Vercel Blob); browser fetches from CDN | **7 days** | **Zero** Redis on landing page load |
| **API cache** (landing-stats + leaderboard) | Legacy fallback if static missing | **7 days** | Tiny only on fallback |
| **Browser localStorage** | Remembers last stats for instant paint | **7 days** | **Zero** Redis |
| **TVL poll** | On-chain pool balances via public RPC | **60 seconds** | **Zero** Redis |

**“Live” feel:** TVL updates every minute on the landing tab; swap volume / user counts update after each **Sunday** cron publish.

## Confirm the fix is live

1. Open `https://www.swaparc.app/api/profile/leaderboard` — JSON should include **`"egressSafe": true`** and **`"scanFree": true`**.
2. Open `https://www.swaparc.app/api/profile/landing-stats` — should include **`"egressSafe": true`** (and no `profiles_sum_recomputed_fallback` in `sources`).
3. Railway **Egress** graph: the **total GB line will not go down** (billing is cumulative), but the **slope should flatten** within a few hours of deploy.

## Stop bleeding immediately (ops)

1. **Railway** — pause Redis or the project if you must halt charges now.
2. **Vercel** — deploy this fix; optionally set `STATS_CRON_DISABLE_PROFILE_SCAN=true` until the cycle ends.
3. **Railway** — set a **usage / budget alert** (e.g. $10–15).
4. **Support** — contact Railway billing; explain accidental egress from public Redis + full scans (one-time credit is sometimes granted; not guaranteed).

**Already metered usage cannot be “reversed” in code** — only new usage stops growing.

## Long-term architecture options

| Approach | Notes |
|----------|--------|
| **Upstash / Vercel KV for Vercel** | REST or Redis with pricing suited to serverless reads |
| **Redis on Railway, workers only on Railway** | Vercel should not use public `REDIS_URL` to Railway for high-volume reads |
| **Never SCAN on user-facing routes** | Only background jobs write aggregates; APIs read O(1) keys |

See also [Jobs and healthchecks](jobs-and-healthchecks.md) for cron paths.

**Optional — auto-update landing JSON without redeploy:** connect Vercel Blob and set `VITE_LANDING_STATS_URL`. Step-by-step: [Landing stats via Vercel Blob](landing-stats-blob.md).
