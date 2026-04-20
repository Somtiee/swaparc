# Redis migration — simple step-by-step (Swaparc)

This guide is for **non-developers**. Do the steps **in order**. If one step fails, stop and fix it before continuing.

**What you’re doing:** Moving your app’s database cache from **Upstash** (expensive per-use billing) to **Redis on Railway** (usually one predictable bill). Your site keeps working; you’re only changing where data is stored.

**Time:** about 30–60 minutes, plus waiting for deploys.

**You need:** accounts on [Railway](https://railway.com), [Vercel](https://vercel.com), [Upstash](https://console.upstash.com), and your code on GitHub (already set up).

---

## Before you start — two links to save

1. **Railway dashboard:** your Swaparc project (where the indexer runs).
2. **Vercel dashboard:** your `swaparc` (or swaparc.app) project.

You will copy long **URLs that look like passwords** — treat them as secrets. Don’t post them in Discord or screenshots with the full URL visible.

---

## Step 1 — Add Redis on Railway (new database)

1. Log in to **Railway** → open the **same project** that runs your **live indexer** (or your main backend project).
2. Click **“New”** (or **“+”**) → choose **“Database”** → **“Add Redis”**  
   *(If you don’t see Redis, use **“Template”** and search for **Redis**, or **“Empty service”** and add a Redis plugin — Railway’s UI changes sometimes; anything that gives you a **Redis** with a connection URL is fine.)*
3. After Redis is created, click the **Redis** service → open **“Variables”** or **“Connect”** / **“Data”** tab.
4. Find **`REDIS_URL`** or **“Redis URL”** / **“Connection URL”**.  
   - It usually starts with `redis://` or `rediss://` (the **`s`** means TLS/secure — that’s normal).
5. Click **copy** and paste it into a **private** note (Notepad, password manager). Label it: **`RAILWAY_REDIS_URL`**.

**Important:** If the host looks like **`something.railway.internal`**, that URL **only works inside Railway**. For migration on your **home PC** and for **Vercel**, you need a **public** URL (often under **Networking** → enable **Public** / **TCP** / **Generate domain**). The public host usually looks like `*.up.railway.app` or a provided hostname — **not** `.internal`.

**You will use this as `REDIS_URL` everywhere later** (same public URL for Vercel + local migration, unless Railway documents a separate internal URL for services in the same project).

Optional but good: in Redis settings, turn on **persistence** (AOF or RDB) if Railway shows the option — helps not lose data if Redis restarts.

---

## Step 2 — Copy the “old” URL from Upstash (source)

You need the **Redis protocol** URL, **not** the REST API URL.

1. Log in to **[Upstash Console](https://console.upstash.com/)**.
2. Click your **Redis database** (the one Swaparc uses today).
3. Click **“Connect”** or **“Details”**.
4. Look for a section named **“Redis”** / **“TCP”** / **“redis-cli”** — **not** “REST API”.
5. Copy the URL that looks like:  
   `rediss://default:XXXX@something.upstash.io:6379`  
   Paste it in your private note. Label it: **`UPSTASH_REDIS_URL`**.

If you only see **REST** (`KV_REST_API_URL` / token), still look for another tab or dropdown — Upstash almost always shows a **Redis URL** for the same data.

---

## Step 3 — (Optional) Pause the indexer so data doesn’t change during copy

**Why:** While copying, every new swap could write to the old database. For most people, copying in a quiet moment is enough. **Strict mode:** stop the indexer worker until migration finishes.

**On Railway:**

1. Open your project → click the **service** that runs `liveSwapIndexer` / `npm run indexer` (whatever you named it).
2. Try one of these (depends on your Railway UI):
   - **Settings** → **Service** → pause / stop / scale to **0** replicas, **or**
   - **Deployments** → stop the running deployment, **or**
   - Temporarily **remove** the start command (only if you know how to put it back).

If you can’t find “pause,” **skip this** and run the migration when traffic is low. The migration script can be run again if needed (it overwrites keys on the destination).

---

## Step 4 — Copy all keys from Upstash → Railway (one-time on your PC)

Do this on the **same computer** where your Swaparc repo lives (with Node.js installed).

### Windows — pick **one** shell (they use different syntax)

**If your window title says “Command Prompt” or the prompt looks like `C:\...>` with no `PS`:** you are in **CMD**. Do **not** use `$env:...` (that is **PowerShell** only).

**CMD (Command Prompt):**

```cmd
cd C:\Users\USER\swaparc
set SOURCE_REDIS_URL=PASTE_UPSTASH_REDIS_URL_HERE
set REDIS_URL=PASTE_RAILWAY_REDIS_URL_HERE
npm run migrate:kv-redis
```

- No spaces around the `=` in `set NAME=value`.
- Paste your real URLs instead of the placeholders (keep them on one line, no quotes needed unless the URL contains `&` — rare).

**PowerShell** (open “Windows PowerShell” or “Terminal” with PowerShell profile):

```powershell
cd C:\Users\USER\swaparc
$env:SOURCE_REDIS_URL = "PASTE_UPSTASH_REDIS_URL_HERE"
$env:REDIS_URL = "PASTE_RAILWAY_REDIS_URL_HERE"
npm run migrate:kv-redis
```

4. Wait until you see **`Source database has ~N keys`**, then **`[batch] +80 keys → total …`** lines, and finally **`Done. … keys processed`**.  
   The script uses **pipelined TYPE + GET/HGETALL/ZRANGE…** (no **DUMP/RESTORE**), because Upstash → Railway often errors with *“DUMP payload version or checksum wrong”* if you use raw dumps across providers. Optional: `set MIGRATE_BATCH_SIZE=120` before `npm run` (max 500).  
   **How long?** Estimate with this quick formula: `(total keys / current keys-per-second)` from your latest `[batch]` line. For ~108k keys, many users see ~20–60 minutes depending on network.
5. If you need to stop mid-way, press **Ctrl + C**. Re-running is safe — existing keys on Railway are overwritten with the latest source values.
6. If you see errors about connection refused or TLS, see **“Problems”** at the bottom.

### Mac / Linux (Terminal)

```bash
cd /path/to/swaparc
export SOURCE_REDIS_URL="PASTE_UPSTASH_REDIS_URL_HERE"
export REDIS_URL="PASTE_RAILWAY_REDIS_URL_HERE"
npm run migrate:kv-redis
```

---

## Step 5 — Put `REDIS_URL` on Vercel (your website)

1. Open **Vercel** → your project → **Settings** → **Environment Variables**.
2. Click **Add New**:
   - **Name:** `REDIS_URL`
   - **Value:** paste your **Railway Redis URL** (same as `RAILWAY_REDIS_URL`).
   - **Environment:** enable **Production** (and **Preview** if you use preview deploys).
3. **Save**.
4. Go to **Deployments** → open the latest deployment → **Redeploy** (so the new variable is picked up).

**Do not delete Upstash variables yet** — delete them only after Step 8 when everything works.

---

## Step 6 — Put the same `REDIS_URL` on Railway (indexer)

1. Railway → open the **indexer** service (not necessarily the Redis service).
2. **Variables** / **Environment** → **Add** `REDIS_URL` = same Railway Redis URL as Vercel.
3. **Redeploy** or restart that service so it loads the new variable.

If the indexer and Redis are **in the same Railway project**, Railway sometimes gives an **internal** Redis URL — use the one Railway documents for **private networking** if both are in the same project; otherwise the public `redis://` / `rediss://` URL is OK.

---

## Step 7 — Test the live site

1. Open **https://www.swaparc.app** (or your URL).
2. Check things that use saved data: **profile**, **leaderboard**, **privpay/payroll** if you use them.
3. If something breaks, check Vercel **Function logs** for Redis connection errors.

---

## Step 8 — Remove Upstash from the app and stop billing

**Only after Step 7 looks good.**

### A) Remove env vars from Vercel

1. Vercel → **Settings** → **Environment Variables**.
2. **Delete** `KV_REST_API_URL` and `KV_REST_API_TOKEN` (if present).
3. **Redeploy** Production again.

### B) Delete the database in Upstash

1. [Upstash Console](https://console.upstash.com/) → your Redis database.
2. **Delete** / **Remove** the database (confirm when asked).

### C) Billing / card

1. Upstash → **Account** / **Billing** / **Team settings** (wording varies).
2. Confirm **no active databases** you still need.
3. Remove or update the **payment method** if you don’t want any future charges.

Upstash’s UI changes; the goal is: **no database you use** + **no card** (or a plan you’re OK paying for).

---

## Problems (quick)

| Symptom | What to try |
|--------|-------------|
| **`getaddrinfo ENOTFOUND redis.railway.internal`** (or any `*.railway.internal`) | That URL is **only for services running inside Railway**. Your **PC** and **Vercel** cannot use it. In Railway → your **Redis** service → **Connect** / **Networking** / **Variables**, copy the **public** Redis URL (host should **not** end in `.railway.internal`). Enable **Public networking** / **TCP proxy** on the Redis service if Railway only shows an internal URL. |
| **`ERR DUMP payload version or checksum are wrong`** | You are likely running an older migration script that used DUMP/RESTORE across providers. Pull latest code and run again; current script uses pipelined type-based copy and avoids this error path. |
| `ECONNREFUSED` | Wrong host/port; firewall; use URL Railway gives you exactly. |
| TLS / SSL errors | Try `rediss://` instead of `redis://` (or the opposite — match what the dashboard says). |
| Vercel can’t reach Redis | Same as above: `REDIS_URL` must be a **public** hostname (not `*.internal`). |
| Migration script errors | Check both URLs are full strings with `redis://` or `rediss://`. No extra spaces. |

---

## Order cheat sheet

1. Create Redis on Railway → save **`REDIS_URL`**.  
2. Copy Upstash **Redis** URL (not REST).  
3. (Optional) Pause indexer.  
4. Run **`npm run migrate:kv-redis`** on your PC.  
5. Add **`REDIS_URL`** to **Vercel** → redeploy.  
6. Add **`REDIS_URL`** to **Railway indexer** → restart.  
7. Test site.  
8. Remove **`KV_*`** from Vercel → delete Upstash DB → fix billing.

---

More technical detail: [kv-migration.md](./kv-migration.md)
