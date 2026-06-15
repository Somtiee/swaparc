/**
 * Railway entrypoint: start live swap indexer immediately; bootstrap in background.
 *
 * Set in Railway service → Settings → Deploy → Start command:
 *   npm run start:railway
 *
 * Requires REDIS_URL (or Upstash KV_REST_*).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kv } from "../lib/server/kv.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP_KEY = "railway:indexer:bootstrap:v1";

function runScript(relPath) {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT, relPath);
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${relPath} exited with code ${code}`));
    });
  });
}

async function bootstrapInBackground() {
  if (process.env.RAILWAY_SKIP_BOOTSTRAP === "1") {
    console.log("RAILWAY_SKIP_BOOTSTRAP=1 — skipping bootstrap");
    return;
  }

  const ru = String(process.env.REDIS_URL || "").trim();
  const hasUpstash =
    String(process.env.KV_REST_API_URL || "").trim() &&
    String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!ru.startsWith("redis://") && !ru.startsWith("rediss://") && !hasUpstash) {
    console.warn("No REDIS_URL / KV — bootstrap skipped");
    return;
  }

  try {
    const done = await kv.get(BOOTSTRAP_KEY);
    if (done) {
      console.log("Railway bootstrap already completed:", done);
      return;
    }
  } catch (e) {
    console.warn("Could not read bootstrap flag:", e?.message || e);
    return;
  }

  console.log("=== Railway background bootstrap: V2 profile backfill ===");
  try {
    await runScript("scripts/backfillSwapPoolV2Profiles.mjs");
    // Do NOT run countUniqueSwappers here — it scans the entire legacy pool (hours)
    // and was blocking the live indexer from ever starting. Landing stats cron handles it.
    await kv.set(BOOTSTRAP_KEY, new Date().toISOString());
    console.log("Bootstrap complete (live indexer was already running).");
  } catch (e) {
    console.error("Background bootstrap failed:", e?.message || e);
  }
}

async function main() {
  console.log("Swaparc Railway worker starting...");
  bootstrapInBackground().catch((e) => {
    console.error("Bootstrap task error:", e?.message || e);
  });
  console.log("Starting live V2 swap indexer now (not waiting for bootstrap)...");
  await runScript("scripts/liveSwapIndexer.js");
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
