/**
 * VPS entrypoint: API + live swap indexer + local crons.
 *
 * Redis stays on the Docker network (localhost from the app's point of view).
 * No Railway Redis. No public Redis port.
 *
 *   node scripts/vpsStart.mjs
 *
 * Env:
 *   VPS_SKIP_INDEXER=1  — API + cron only (use during Redis migrate)
 *   CRON_SECRET         — required in production; sent to local cron routes
 *   PORT                — API port (default 3005)
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = String(process.env.PORT || 3005).trim() || "3005";
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const SKIP_INDEXER =
  String(process.env.VPS_SKIP_INDEXER || "").trim() === "1";
const FIVE_MIN_MS = 5 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function spawnKeepAlive(name, relPath) {
  const script = path.join(ROOT, relPath);
  const run = () => {
    console.log(`[vps] starting ${name}: ${relPath}`);
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`[vps] ${name} spawn error:`, err?.message || err);
    });
    child.on("exit", (code, signal) => {
      console.error(
        `[vps] ${name} exited code=${code} signal=${signal || ""} — restarting in 2s`
      );
      setTimeout(run, 2000);
    });
  };
  run();
}

function cronHeaders() {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const headers = { Accept: "application/json" };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function pingCron(pathname) {
  const url = `http://127.0.0.1:${PORT}${pathname}`;
  try {
    const res = await fetch(url, { method: "GET", headers: cronHeaders() });
    const text = await res.text();
    const preview = text.slice(0, 240).replace(/\s+/g, " ");
    if (!res.ok) {
      console.error(`[vps] cron ${pathname} HTTP ${res.status}: ${preview}`);
      return;
    }
    console.log(`[vps] cron ${pathname} OK: ${preview}`);
  } catch (err) {
    console.error(`[vps] cron ${pathname} failed:`, err?.message || err);
  }
}

async function waitForApi(maxMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(HEALTH_URL, { method: "GET" });
      if (res.ok) {
        console.log("[vps] API health OK");
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API did not become healthy at ${HEALTH_URL}`);
}

function msUntilNextSundayUtc() {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const day = next.getUTCDay();
  const add = day === 0 ? 7 : 7 - day;
  next.setUTCDate(next.getUTCDate() + add);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next.getTime() - now.getTime();
}

function startCrons() {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) {
    console.warn(
      "[vps] CRON_SECRET is empty — local payment/stats crons will fail in production"
    );
  }

  const runPayments = () => {
    pingCron("/api/payments/recurring/run");
    pingCron("/api/payments/payroll/run");
  };

  setTimeout(runPayments, 15_000);
  setInterval(runPayments, FIVE_MIN_MS);

  const weekDelay = msUntilNextSundayUtc();
  console.log(
    `[vps] landing-stats cron in ${Math.round(weekDelay / 3600000)}h (Sunday 00:00 UTC)`
  );
  setTimeout(() => {
    pingCron("/api/profile/refresh-landing-stats");
    setInterval(
      () => pingCron("/api/profile/refresh-landing-stats"),
      WEEK_MS
    );
  }, weekDelay);
}

async function main() {
  console.log("Swaparc VPS worker starting...");
  console.log(`  indexer: ${SKIP_INDEXER ? "skipped (VPS_SKIP_INDEXER=1)" : "on"}`);
  spawnKeepAlive("api", "server.js");
  if (!SKIP_INDEXER) {
    spawnKeepAlive("indexer", "scripts/liveSwapIndexer.js");
  }
  await waitForApi();
  startCrons();
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
