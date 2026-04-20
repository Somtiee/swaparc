# KV / Redis migration (Upstash → Railway or any Redis)

**New to this?** Follow the plain checklist first: **[kv-migration-simple.md](./kv-migration-simple.md)** (step-by-step for non-developers, including Windows).

---

Swaparc uses `lib/server/kv.js`:

- **`REDIS_URL`** (recommended) — TCP Redis, e.g. `redis://` or `rediss://` (TLS). Use this on **Vercel**, **Railway** (indexer), and local `.env`.
- **Legacy:** `KV_REST_API_URL` + `KV_REST_API_TOKEN` — Upstash **REST** (per-request billing). Keep only during cutover if needed.

## 1. Create Redis on Railway

1. Open your Railway project → **New** → **Database** → **Add Redis** (or deploy a Redis template).
2. Copy the **Redis connection URL** (often `redis://default:PASSWORD@HOST:PORT` or TLS).
3. For services inside Railway, prefer the **private/internal** URL if shown.
4. Enable **persistence** in Redis settings (AOF or RDB) for production.

## 2. Set environment variables

### Vercel (Production / Preview)

Project → **Settings** → **Environment Variables**:

- Add **`REDIS_URL`** = your Railway (or managed) Redis URL.  
  Use **`rediss://`** if the provider requires TLS.
- After verification, **remove** `KV_REST_API_URL` and `KV_REST_API_TOKEN` so you are not charged for Upstash REST.

### Railway (indexer worker)

In the service that runs `scripts/liveSwapIndexer.js`, set the **same** `REDIS_URL` (or Railway’s private Redis URL if co-located).

### Local development

In `.env`:

```env
REDIS_URL=redis://localhost:6379
# or rediss://... for TLS
```

## 3. Migrate existing data (planned cutover)

**Best method:** use the **native Redis URL** from Upstash (not the REST API):

1. Upstash dashboard → your database → **Connect** → copy the **Redis** URL (`redis://` or `rediss://`).
2. Destination: your new **`REDIS_URL`** (Railway).
3. Pause the live indexer and temporarily avoid writes (or accept a small drift window).
4. Run:

```bash
SOURCE_REDIS_URL="rediss://default:...@....upstash.io:6379" ^
REDIS_URL="redis://default:...@....railway.app:6379" ^
node scripts/migrateRedisToRedis.mjs
```

5. Deploy app + workers with **`REDIS_URL`** only; smoke-test profile, leaderboard, payroll, privpay.
6. When happy, **delete or disable** the Upstash database (see below).

If you only ever used **REST** and never opened the Redis protocol, Upstash still provides a Redis URL for the same data — use that as `SOURCE_REDIS_URL`.

## 4. Stop paying Upstash

1. Log in to [Upstash](https://console.upstash.com/).
2. Open your Redis database → **Delete** (or **Pause** if available).
3. **Billing:** Account / Subscription → remove extra databases, confirm no active paid databases.
4. **Payment method:** Settings / Billing → remove card or cancel subscription per Upstash’s current UI (wording may change).

After deletion, **remove** `KV_REST_API_URL` and `KV_REST_API_TOKEN` from Vercel and Railway so nothing accidentally keeps calling REST.

## 5. Troubleshooting

- **`ECONNREFUSED` / TLS errors:** Use `rediss://` for TLS endpoints; ensure Vercel can reach the host (some providers require **public** URL and IP allowlisting).
- **Memory:** large leaderboards and hashes need enough Redis **maxmemory**; monitor Railway metrics.
- **Multi-region:** one Redis = single point of latency; acceptable for most Swaparc workloads.

## 6. Next steps

- Push to GitHub, deploy Vercel with `REDIS_URL`.
- Configure **Vercel Cron** for `/api/payments/recurring/run` and payroll as planned.
