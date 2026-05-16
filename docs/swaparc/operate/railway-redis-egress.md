# Railway Redis egress and landing stats

## Why a $5 plan can show a $50+ bill

Railway **Hobby** includes about **$5/month of usage credit**. Above that, you pay for what you use — especially **egress** (data leaving Railway’s network).

If **Redis runs on Railway** and **Vercel** connects with a public `REDIS_URL`, then **every read** of profile data from Vercel counts as **Railway egress**, billed per GB (on the order of **$0.05/GB**).

A full scan of all `profile:*` keys pulls **every profile** out of Redis on each request. That is fine at small scale and catastrophic at traffic scale.

## What caused the spike (SwapArc)

Several patterns compounded:

1. **`/api/profile/leaderboard`** (homepage) **SCAN + MGET all `profile:*` on every call**, polled **every 60 seconds** on the landing tab — often the largest egress source.

2. **`/api/profile/landing-stats`** used to **SCAN all profiles** on cache misses (fixed in an earlier deploy).

3. **`/api/profile/refresh-landing-stats`** cron scanned all profiles on a schedule (now **once per day**; set `STATS_CRON_DISABLE_PROFILE_SCAN=true` to stop entirely).

Together this can reach **hundreds of GB of egress** in a billing cycle.

## What we changed (fix)

| Change | Effect |
|--------|--------|
| **leaderboard** uses Redis **sorted sets** + top-10 profile reads only (no `profile:*` SCAN) | Stops the 60s homepage poll from exporting the whole DB |
| **landing-stats** no longer scans `profile:*` | Hot path only reads small precomputed keys + high-water marks |
| **Response cache 15 minutes** + CDN `Cache-Control` | Far fewer KV round-trips per visitor |
| **Landing page** polls leaderboard every **1 hour** (not 60s) | Fewer API calls |
| **API caches 1 hour** on landing-stats + leaderboard | Few Redis reads per visitor |
| **Cron schedule once daily** (`0 0 * * *`) | One profile scan per day |
| **`STATS_CRON_DISABLE_PROFILE_SCAN=true`** | Emergency stop for the cron scan only |

Precomputed keys (written by the hourly cron):

- `stats:countUniqueSwappers:last`
- `stats:totalSwapVolume:last`

## How the layers fit together (plain English)

Think of **four layers** — only the **daily cron** does the expensive “read every profile” work.

| Layer | What it is | Typical interval | Railway cost |
|-------|------------|------------------|--------------|
| **Stats cron** | Background job writes precomputed totals into Redis | **Once per day** | **High once/day** (one full scan) |
| **API cache** (landing-stats + leaderboard) | Server saves the last JSON answer in Redis; repeats serve that blob | **6 hours** | **Tiny** per hit (one small read) |
| **Browser poll** | Landing tab asks the API again | Stats **30 min**, leaderboard **3 h** | Triggers Vercel → Redis only when cache expired |
| **Browser localStorage** | Your phone remembers last stats so reload feels instant | **6 hours** | **Zero** Redis |

**Why poll every 30 min if cache is 6 h?**  
Polls are cheap now (no profile scan). The 30 min poll mainly refreshes **TVL** (on-chain pool balances, not Railway) and occasionally picks up a new cached stats blob after the daily cron. The **big numbers** (swaps, users, volume) update when the **daily cron** runs; between runs they stay stable (high-water never goes down).

**“Live” feel:** Cards still animate and TVL can move; swap/user totals step up after each daily refresh — not second-by-second.

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
