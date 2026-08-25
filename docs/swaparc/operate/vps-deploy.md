# VPS deploy (cut Railway Redis cost)

This is the click-by-click path to run **API + Redis + swap indexer** on one cheap VPS so Railway network egress goes to **$0**. The website stays on Vercel (~$20). Typical VPS cost is **about $4–6 / month**.

You do **not** need to be a developer. Copy each command exactly. If a step fails, stop and paste the error into chat.

## What you will have when finished

| Thing | Where it runs | Monthly cost |
|---|---|---|
| Website (buttons, pages) | Vercel (unchanged) | ~$20 |
| `/api` (profiles, PrivPay, bills, payroll) | Your VPS | included |
| Redis (database) | Same VPS, not exposed to the internet | included |
| Swap indexer | Same VPS | included |
| Railway | **Deleted** | **$0** |

Users still open **https://swaparc.app**. Nothing about wallets or swaps changes.

## Before you start — gather these 4 things

1. **Your GitHub repo URL** for SwapArc (the code you push to).
2. **Vercel** login (the project that hosts swaparc.app).
3. **Railway** login (Redis + the indexer service you will turn off).
4. **Domain DNS** login (wherever `swaparc.app` is managed: Vercel, Cloudflare, Namecheap, etc.).

Also copy, into a notepad, from **Vercel → Project → Settings → Environment Variables**:

- `CRON_SECRET`
- `ARC_RPC_URL` (and fallbacks if you have them)
- `PRIVACY_POOL_RELAYER_PRIVATE_KEY` and other PrivPay/Circle/relayer keys
- `BLOB_READ_WRITE_TOKEN`
- `CIRCLE_API_KEY` if you use email wallets
- Every other variable **except** `REDIS_URL` / `KV_REST_*`

You will paste those into a file on the VPS. Do not skip keys — the VPS must match Vercel.

From **Railway → Redis service → Variables**, copy the **public** `REDIS_URL` (starts with `redis://` or `rediss://`). You need it **once** to copy data off Railway. Keep it private.

---

## Step 1 — Push this code to GitHub

On your PC, commit and push the VPS files (Docker, scripts, this guide) to GitHub. The VPS will download the repo from GitHub.

If you want this chat to make the git commit for you, say so.

---

## Step 2 — Buy the VPS (about $5 / month)

Use **Hetzner Cloud** (cheapest) or **DigitalOcean**.

### Hetzner (recommended)

1. Create an account at [https://www.hetzner.com/cloud](https://www.hetzner.com/cloud).
2. **Add a server**.
3. Location: pick **Ashburn**, **Hillsboro**, **Falkenstein**, or **Helsinki** (any is fine).
4. Image: **Ubuntu 24.04**.
5. Type: **CX22** (x86 / Intel or AMD).  
   **Do not** pick **CAX** (ARM).
6. Networking: leave **IPv4** on.
7. SSH key: skip if you are unsure — Hetzner will email a root password, or use the web console.
8. Create the server. Copy the **IPv4 address** (looks like `5.161.x.x`).

### DigitalOcean alternative

Create a **Basic Droplet**, Ubuntu 24.04, **$6/mo Regular** (1 GB is tight; **$12 / 2 GB** is safer if Hetzner is not an option). Copy the IPv4.

---

## Step 3 — Point `api.swaparc.app` at the VPS

In your DNS panel (same place as `swaparc.app`):

1. Add an **A** record.
2. Name / host: `api`
3. Value: the VPS IPv4 from Step 2.
4. Proxy / orange cloud (Cloudflare): **DNS only** (grey cloud). Caddy cannot get a certificate if Cloudflare is proxying.

Wait 2–5 minutes.

**Do not** add `api.swaparc.app` as a domain inside the Vercel project. Vercel must not own that hostname.

Check from your PC (PowerShell):

```powershell
nslookup api.swaparc.app
```

It should show the VPS IP.

---

## Step 4 — Open the VPS and install Docker

On Hetzner: server → **Console**. Log in as `root`.

Paste this **entire** block, then Enter:

```bash
apt-get update && apt-get install -y ca-certificates curl git docker.io docker-compose-v2 ufw
systemctl enable --now docker
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
docker --version && docker compose version
```

You should see Docker version numbers. If `docker compose` is missing, stop and send the error.

---

## Step 5 — Download SwapArc on the VPS

Replace the URL with **your** GitHub repo:

```bash
cd /root
git clone https://github.com/YOUR_USER/swaparc.git swaparc
cd /root/swaparc
cp deploy/vps/env.example .env
nano .env
```

`nano` is a text editor:

1. Paste every Vercel env var (one `NAME=value` per line).
2. Set `VPS_API_DOMAIN=api.swaparc.app`
3. Set `VPS_SKIP_INDEXER=1` (indexer off until Redis is copied).
4. Set `CRON_SECRET=` to the same secret as Vercel.
5. Save: `Ctrl+O`, Enter, then exit: `Ctrl+X`.

Do **not** put Railway’s Redis URL into `REDIS_URL`. Compose always uses the local Redis.

---

## Step 6 — Start API + Redis (indexer still off)

```bash
cd /root/swaparc
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Wait until you see `API health OK`. Exit logs with `Ctrl+C` (the app keeps running).

On your PC, open:

`https://api.swaparc.app/api/health`

You want: `{"status":"ok","service":"swaparc-api"}`.

If the browser says certificate / DNS error, wait 5 minutes and retry. Caddy needs DNS to be correct before HTTPS works.

---

## Step 7 — Copy Redis from Railway onto the VPS

**Do not stop Railway Redis yet.** Only copy.

On the VPS, paste this **one line**, replacing `PASTE_RAILWAY_REDIS_URL` with the public Railway `REDIS_URL`:

```bash
docker compose exec -e SOURCE_REDIS_URL='PASTE_RAILWAY_REDIS_URL' app node scripts/migrateRedisToRedis.mjs
```

Wait until it finishes without errors. This can take several minutes.

If people are still using the live site, Railway Redis may receive a few more writes during the copy. Run the **same command a second time** after it succeeds (it overwrites keys). Then go to Step 8 immediately.

If it fails, do not continue. Paste the log.

---

## Step 8 — Stop the Railway indexer, start the VPS indexer

Two indexers at once will **double-count swaps**. Order matters.

1. Railway → the **swaparc** worker / indexer service → **Stop** (or remove the start command / scale to 0).
2. On the VPS:

```bash
cd /root/swaparc
nano .env
```

Change `VPS_SKIP_INDEXER=1` to `VPS_SKIP_INDEXER=0`. Save and exit.

```bash
docker compose up -d
docker compose logs -f app
```

You should see the live indexer heartbeats. `Ctrl+C` when it looks healthy.

---

## Step 9 — Point Vercel `/api` at the VPS (website stays on Vercel)

On your PC, in the SwapArc repo:

1. Copy `deploy/vps/vercel.frontend-only.json` over `vercel.json`.
2. Add this line to `.vercelignore`:

```
api
```

That line is required. If you skip it, Vercel keeps running `/api` on serverless and the Railway bill comes back.

3. Commit, push, and wait for the Vercel deploy to finish.

4. Vercel → Settings → Environment Variables → **delete** `REDIS_URL`, `KV_REST_API_URL`, and `KV_REST_API_TOKEN` from Production (and Preview). You do not need Redis on Vercel anymore.

5. Open **https://swaparc.app**, connect a wallet, load a profile. Confirm it works.

---

## Step 10 — Turn Railway off (this is the cost win)

After the site has worked on the VPS for a day:

1. Railway → **Redis** service → delete.
2. Railway → indexer / swaparc service → delete.
3. If the Railway project is empty, delete the project.

Usage should drop to **$0**. The current month may still show leftover egress from *before* the cutover; next month should be clean.

---

## Everyday commands (VPS console)

```bash
cd /root/swaparc

# Status
docker compose ps

# Logs
docker compose logs -f app

# After you push new code to GitHub
git pull
docker compose up -d --build
```

---

## If something is wrong

| Symptom | What to do |
|---|---|
| `api.swaparc.app` has no HTTPS | DNS A record wrong, or Cloudflare orange cloud. Wait, then `docker compose restart caddy` |
| Health URL works but swaparc.app APIs fail | Step 9: `api` missing from `.vercelignore`, or Vercel deploy not finished |
| Profiles empty after cutover | Step 7 migrate did not run, or indexer started before migrate |
| Duplicate swap counts | Railway indexer was still running. Stop it. Counts may need a stats refresh |
| Bills/payroll not auto-running | `CRON_SECRET` mismatch, or `RECURRING_SERVER_EXECUTION_ENABLED` not `true` on the VPS |

---

## What keeps this cheap (and payments on time)

- Open tabs still trigger due bills/payroll about every 15 seconds. On the VPS that hits **local Redis**, so it does not create a Railway egress bill.
- The VPS cron also runs those jobs every 5 minutes so payments still fire if **nobody** has the app open.
- Redis is not reachable from the public internet. Only the API container talks to it.

Optional later: if you do not need Vercel Pro features, you can switch Vercel to Hobby after crons live on the VPS. That is extra savings; it is not required for this cutover.
