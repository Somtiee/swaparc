# Railway Redis egress and landing stats

## Why a $5 plan can show a $50+ bill

Railway **Hobby** includes about **$5/month of usage credit**. Above that, you pay for what you use — especially **egress** (data leaving Railway’s network).

If **Redis runs on Railway** and **Vercel** connects with a public `REDIS_URL`, then **every read** of profile data from Vercel counts as **Railway egress**, billed per GB (on the order of **$0.05/GB**).

A full scan of all `profile:*` keys pulls **every profile** out of Redis on each request. That is fine at small scale and catastrophic at traffic scale.

## What caused the spike (SwapArc)

Two patterns compounded:

1. **`/api/profile/landing-stats`** (homepage) used to **SCAN + MGET all `profile:*`** on many cache misses (60s cache, and sometimes **two scans per request**). Every visitor could trigger a full export of the profile dataset from Railway → Vercel.

2. **`/api/profile/refresh-landing-stats`** cron ran **every 15 minutes** and also scanned all profiles (smaller than (1), but still steady egress).

Together this can reach **hundreds of GB of egress** in a billing cycle.

## What we changed (fix)

| Change | Effect |
|--------|--------|
| **landing-stats** no longer scans `profile:*` | Hot path only reads small precomputed keys + high-water marks |
| **Response cache 15 minutes** + CDN `Cache-Control` | Far fewer KV round-trips per visitor |
| **Cron schedule hourly** (`0 * * * *`) instead of every 15 min | ~4× less scheduled scan traffic |
| **`STATS_CRON_DISABLE_PROFILE_SCAN=true`** | Emergency stop for the cron scan only |

Precomputed keys (written by the hourly cron):

- `stats:countUniqueSwappers:last`
- `stats:totalSwapVolume:last`

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
