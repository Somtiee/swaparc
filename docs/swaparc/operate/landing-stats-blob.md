# Landing stats via Vercel Blob (weekly cron, no redeploy)

By default the landing page reads **`/stats/landing-network.json`** from your git deploy. That file only changes when you redeploy (or commit an updated `public/stats/landing-network.json`).

With **Vercel Blob**, the weekly cron (`/api/profile/refresh-landing-stats`) uploads fresh JSON after each Sunday scan. The browser loads that URL instead — **no git push** needed for new totals.

## What you need

| Variable | Where | Purpose |
|----------|--------|---------|
| `BLOB_READ_WRITE_TOKEN` | Vercel **server** (Production) | Cron/API uploads `landing-network.json` |
| `VITE_LANDING_STATS_URL` | Vercel **build** (Production) | Frontend fetches Blob URL instead of `/stats/...` |
| `CRON_SECRET` | Vercel server | Required to **manually** trigger the cron for the first upload |
| `REDIS_URL` | Vercel server | Cron still reads Redis to build the payload |

`VITE_*` variables are baked in at **build time**. After you set `VITE_LANDING_STATS_URL`, you must **redeploy once**. Later weekly cron runs only update Blob — no redeploy.

---

## Step 1 — Create a **Public** Blob store (Vercel dashboard)

> **Important:** Access mode (**Public** vs **Private**) is chosen at creation and **cannot be changed later**.  
> If you see `Cannot use public access on a private store`, create a **new** store with **Public** access (see below).

1. Open [vercel.com](https://vercel.com) → your **swaparc** project.
2. Go to **Storage** → **Create Database / Store** → choose **Blob**.
3. On the access step, select **Public** (required — the landing page loads JSON by URL in the browser).
4. Name it (e.g. `swaparc-landing-stats-public`) and connect it to this project.
5. Vercel updates **`BLOB_READ_WRITE_TOKEN`** for the connected store. Confirm under **Settings → Environment Variables** (Production).
6. **Redeploy** Production so serverless functions use the new token.
7. (Optional) Disconnect or delete the old **Private** `swaparc-blob` store if you no longer need it.

If the token is missing, open the Blob store → **`.env.local` / Connect** and copy `BLOB_READ_WRITE_TOKEN` into Production env.

---

## Step 2 — First upload (get the public Blob URL)

You need one successful cron run **after** `BLOB_READ_WRITE_TOKEN` is set.

### Option A — Manual trigger (recommended)

From your machine (replace values):

```bash
curl -sS -X GET "https://www.swaparc.app/api/profile/refresh-landing-stats" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expect JSON like:

```json
{
  "ok": true,
  "staticPublished": true,
  "staticUrl": "https://xxxxxxxx.public.blob.vercel-storage.com/landing-network.json",
  ...
}
```

Copy **`staticUrl`** — that is your `VITE_LANDING_STATS_URL`.

> The job scans all `profile:*` keys in Redis. It can take minutes on a large DB. Check **Vercel → Deployments → Functions → Logs** if the request times out.

### Option B — Local publish (if you have `REDIS_URL` locally)

```bash
# In repo root, with REDIS_URL and BLOB_READ_WRITE_TOKEN in .env
npm run stats:publish-landing
```

The script prints `Blob URL:` when upload succeeds.

### Option C — Wait for Sunday UTC

Cron schedule: `0 0 * * 0` (Sunday 00:00 UTC). Check function logs for `staticUrl` in the response.

---

## Step 3 — Set `VITE_LANDING_STATS_URL` and redeploy once

1. **Settings → Environment Variables → Add**
   - **Name:** `VITE_LANDING_STATS_URL`
   - **Value:** the full `staticUrl` from step 2 (must be `https://...` and end with `landing-network.json`)
   - **Environments:** at least **Production** (add Preview if you want preview deploys to use Blob too)

2. **Deployments → … → Redeploy** (or push any commit) so Vite rebuilds with the new variable.

3. Verify in the browser:
   - Open the landing tab → DevTools → **Network**.
   - You should see a request to your **blob.vercel-storage.com** URL (not only `/stats/landing-network.json`).
   - Response JSON should have `"source": "weekly-cron-static"` (after cron) or similar.

---

## Step 4 — Confirm weekly updates (no more redeploys)

Every Sunday UTC the cron:

1. Scans profiles in Redis (one egress spike per week).
2. Uploads JSON to Blob (`allowOverwrite: true` — **same URL** each week).
3. Returns `staticUrl` in the cron response (for logging).

Visitors on the next landing load get the new file (CDN cache is 7 days; browser may cache too — stats are designed to be weekly, not minute-by-minute).

---

## Will Blob spike my Vercel bill?

**No — not at SwapArc’s scale.** Compared to ~$58+ Railway Redis egress, Blob is negligible:

| Your usage | Rough cost |
|------------|------------|
| **1 upload/week** (`put`) | ~52 “advanced” ops/year — Hobby includes **2,000/month** |
| **One JSON file** (~5–20 KB) | Storage far under Hobby **1 GB** included |
| **Landing visitors** reading the URL | Small “simple” ops + CDN; cache HITs are cheap |

Hobby: Blob is **free within included limits**; you get email warnings before hard limits. Pro: tiny on-demand if you exceed credits.

This will **not** replace your main Vercel bill (functions, bandwidth). It should stay **cents per month** unless you store huge files or millions of downloads.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot use public access on a private store` | Store was created **Private** — create a new **Public** Blob store and redeploy (cannot flip access later) |
| `staticUrl: null`, other `blobError` | Read `blobError`; redeploy **after** token exists; check **Storage → your store → Browse** for `landing-network.json` |
| `blobConfigured: false` | `BLOB_READ_WRITE_TOKEN` missing on **this** deployment — redeploy |
| Landing still hits `/stats/landing-network.json` | `VITE_LANDING_STATS_URL` unset or deploy happened **before** you added it — redeploy |
| Old numbers after Sunday | Hard refresh; Blob/CDN cache up to 7 days is expected |
| Cron `401 Unauthorized` | Set `CRON_SECRET` on Vercel and send `Authorization: Bearer ...` |
| Cron `skipped: true` | Remove or set `STATS_CRON_DISABLE_PROFILE_SCAN` to not `true` |

## Fallback (no Blob)

If Blob is not configured, nothing breaks:

- Landing uses **`/stats/landing-network.json`** from the last deploy.
- APIs `/api/profile/landing-stats` and `/api/profile/leaderboard` remain 7-day cached fallbacks.

See [Railway Redis egress](railway-redis-egress.md) for the full landing-stats architecture.
