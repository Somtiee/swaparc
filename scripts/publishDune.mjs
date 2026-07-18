/**
 * Publish SwapArc analytics to Dune (tables + queries).
 *
 * Weekly sync (no Redis): fetches public landing JSON, uploads KPI tables.
 * Full publish: also uploads grant/on-chain CSVs from data/dune-export/grant/.
 *
 * Usage:
 *   DUNE_API_KEY=... npm run stats:publish-dune           # full (after Phase 1 exports)
 *   DUNE_API_KEY=... npm run stats:sync-dune-weekly       # landing KPIs only (Sunday cron)
 *
 * Options:
 *   --weekly-only   Skip grant/on-chain tables (default for stats:sync-dune-weekly)
 *   --skip-queries  Upload tables only (if API plan blocks query create)
 *   --queries-only  Update SQL on existing queries only (no CSV re-upload)
 *   --dry-run       Print actions without calling Dune API
 */

import "dotenv/config";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  uploadCsv,
  createQuery,
  updateQuery,
  archiveQuery,
  namespaceFromFullName,
  DuneApiError,
  requireApiKey,
} from "../lib/dune/client.mjs";
import { syncLandingFromUrl, DUNE_DB_DIR } from "../lib/dune/landingSync.mjs";
import { DUNE_QUERY_SPECS, DUNE_ARCHIVED_QUERY_KEYS, sqlForNamespace } from "../lib/dune/queries.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRANT_DIR = join(ROOT, "data/dune-export/grant");
const STATE_PATH = join(ROOT, "data/dune-export/dune-state.json");

const args = new Set(process.argv.slice(2));
const WEEKLY_ONLY = args.has("--weekly-only") || process.env.DUNE_WEEKLY_ONLY === "true";
const SKIP_QUERIES = args.has("--skip-queries");
const QUERIES_ONLY = args.has("--queries-only");
const DRY_RUN = args.has("--dry-run");

const TABLE_UPLOADS = [
  {
    group: "db",
    file: "swaparc_network_totals.csv",
    tableName: "swaparc_network_totals",
    description:
      "SwapArc platform headline KPIs (swap count, volume, users) — synced from swaparc.app landing JSON.",
    weekly: true,
  },
  {
    group: "db",
    file: "swaparc_network_totals_history.csv",
    tableName: "swaparc_network_totals_history",
    description: "Weekly snapshots of platform KPIs for trend charts.",
    weekly: true,
  },
  {
    group: "db",
    file: "swaparc_all_profiles.csv",
    tableName: "swaparc_all_profiles",
    description: "All trader/LP profiles ranked (170k+). Paginated + searchable on dashboard.",
    weekly: false,
  },
  {
    group: "db",
    file: "swaparc_top_swap_volume.csv",
    tableName: "swaparc_top_swap_volume",
    description: "Top traders by platform swap volume.",
    weekly: true,
  },
  {
    group: "db",
    file: "swaparc_top_swap_count.csv",
    tableName: "swaparc_top_swap_count",
    description: "Top traders by swap count.",
    weekly: true,
  },
  {
    group: "db",
    file: "swaparc_top_lp.csv",
    tableName: "swaparc_top_lp",
    description: "Top liquidity providers.",
    weekly: true,
  },
  {
    group: "grant",
    file: "swaparc_swap_pool_total.csv",
    tableName: "swaparc_swap_pool_total",
    description: "Legacy + V2 pool segment totals (platform counts + on-chain volume).",
    weekly: false,
  },
  {
    group: "grant",
    file: "swaparc_old_swap_pool_summary.csv",
    tableName: "swaparc_old_swap_pool_summary",
    description: "Legacy pool summary (avoids uploading 8M+ row CSV).",
    weekly: false,
  },
  {
    group: "grant",
    file: "swaparc_new_swap_pool.csv",
    tableName: "swaparc_new_swap_pool",
    description: "V2 swap pool on-chain swaps from Arcscan.",
    weekly: false,
  },
  {
    group: "grant",
    file: "swaparc_privpay.csv",
    tableName: "swaparc_privpay",
    description: "PrivPay deposits and withdrawals on Arc testnet.",
    weekly: false,
  },
  {
    group: "grant",
    file: "swaparc_lp_pools.csv",
    tableName: "swaparc_lp_pools",
    description: "LP pool TVL breakdown (USDC/EURC, USDC/SWPRC, EURC/SWPRC) — matches landing page.",
    weekly: false,
  },
];

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { queries: {}, uploads: {}, namespace: null, dashboard: null };
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function resolveTablePath(spec) {
  const base = spec.group === "grant" ? GRANT_DIR : DUNE_DB_DIR;
  return join(base, spec.file);
}

async function uploadTables(state) {
  const uploads = [];
  let namespace = state.namespace || process.env.DUNE_NAMESPACE || null;

  const specs = TABLE_UPLOADS.filter((t) => !WEEKLY_ONLY || t.weekly);

  for (const spec of specs) {
    const path = resolveTablePath(spec);
    if (!(await fileExists(path))) {
      console.warn(`  SKIP (missing): ${spec.file}`);
      continue;
    }

    const data = await readFile(path, "utf8");
    const sizeMb = (Buffer.byteLength(data, "utf8") / (1024 * 1024)).toFixed(2);
    console.log(`  Upload ${spec.tableName} (${sizeMb} MB)…`);

    if (DRY_RUN) {
      uploads.push({ tableName: spec.tableName, path, dryRun: true });
      continue;
    }

    const result = await uploadCsv({
      data,
      tableName: spec.tableName,
      description: spec.description,
      isPrivate: false,
    });

    if (!namespace && result.full_name) {
      namespace = namespaceFromFullName(result.full_name);
    }

    uploads.push({
      tableName: spec.tableName,
      fullName: result.full_name,
      path,
      sizeMb: Number(sizeMb),
    });
    state.uploads[spec.tableName] = {
      fullName: result.full_name,
      uploadedAt: new Date().toISOString(),
    };
  }

  if (namespace) state.namespace = namespace;
  return { uploads, namespace };
}

async function archiveDeprecatedQueries(state) {
  const queryIds = state.queries || {};
  for (const key of DUNE_ARCHIVED_QUERY_KEYS) {
    const id = queryIds[key];
    if (!id || DRY_RUN) continue;
    try {
      console.log(`  Archive deprecated: ${key} (#${id})`);
      await archiveQuery(id);
      delete queryIds[key];
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`    ⚠ Could not archive ${key}: ${err.message}`);
    }
  }
  state.queries = queryIds;
}

async function upsertQueries(state, namespace) {
  if (!namespace) {
    throw new Error("Could not detect Dune namespace from upload. Set DUNE_NAMESPACE in .env.");
  }

  await archiveDeprecatedQueries(state);

  const queryIds = { ...(state.queries || {}) };
  const results = [];
  const activeKeys = new Set(DUNE_QUERY_SPECS.map((s) => s.key));

  for (const spec of DUNE_QUERY_SPECS) {
    const sql = sqlForNamespace(spec, namespace);
    const existingId = queryIds[spec.key];
    const parameters = spec.parameters || [];

    console.log(`  Query: ${spec.name}${existingId ? ` (update #${existingId})` : " (create)"}`);

    if (DRY_RUN) {
      results.push({ key: spec.key, dryRun: true });
      continue;
    }

    try {
      if (existingId) {
        await updateQuery(existingId, {
          name: spec.name,
          sql,
          description: spec.description,
          tags: spec.tags,
          parameters,
        });
        results.push({ key: spec.key, queryId: existingId, action: "updated" });
      } else {
        const created = await createQuery({
          name: spec.name,
          sql,
          description: spec.description,
          tags: spec.tags,
          parameters,
          isPrivate: false,
        });
        const queryId = created.query_id;
        queryIds[spec.key] = queryId;
        results.push({ key: spec.key, queryId, action: "created" });
      }
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      if (err instanceof DuneApiError && (err.status === 402 || err.status === 403 || err.status === 429)) {
        console.warn(
          `    ⚠ Query API blocked (${err.status}). Wait a minute and run: npm run stats:fix-dune-queries`
        );
        results.push({ key: spec.key, error: err.message, skipped: true });
        break;
      }
      throw err;
    }
  }

  // Drop stale query ids no longer in specs (except archived keys already removed)
  for (const key of Object.keys(queryIds)) {
    if (!activeKeys.has(key) && !DUNE_ARCHIVED_QUERY_KEYS.includes(key)) {
      // keep unknown keys
    }
  }

  state.queries = queryIds;
  return results;
}

function printSummary({ landing, uploads, namespace, queryResults, state }) {
  console.log("\n========================================");
  console.log("DUNE PUBLISH COMPLETE");
  console.log("========================================");
  if (landing) {
    console.log(`Landing:  ${landing.landingUrl}`);
    console.log(`Refreshed: ${landing.refreshedAt}`);
    console.log(
      `KPIs:     ${Number(landing.stats?.totalSwapCount || 0).toLocaleString()} swaps | ` +
        `$${Number(landing.stats?.totalSwapVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} volume | ` +
        `${Number(landing.stats?.uniqueUsers || 0).toLocaleString()} users`
    );
  }
  console.log(`Tables:   ${uploads.length} uploaded`);
  if (namespace) console.log(`Namespace: dune.${namespace}.*`);
  if (queryResults?.length) {
    const created = queryResults.filter((r) => r.action === "created" || r.action === "updated");
    console.log(`Queries:  ${created.length} synced`);
  }

  const firstQueryId = state.queries?.kpi_total_swaps;
  if (firstQueryId) {
    console.log(`\nOpen queries: https://dune.com/queries/${firstQueryId}`);
  }
  console.log(
    "\nDashboard: In Dune → New Dashboard → add visualizations from the SwapArc queries above."
  );
  console.log(
    "           Tag filter: swaparc. Suggested tabs: Overview | Swaps | Liquidity | PrivPay"
  );
  if (state.dashboard?.url) {
    console.log(`           Saved dashboard: ${state.dashboard.url}`);
  }
  console.log(`\nState file: ${STATE_PATH}`);
  console.log("========================================\n");
}

async function main() {
  console.log(WEEKLY_ONLY ? "SwapArc → Dune weekly sync" : "SwapArc → Dune full publish");
  if (DRY_RUN) console.log("(dry run — no API calls)\n");

  if (!DRY_RUN) requireApiKey();

  let landing = null;
  if (!QUERIES_ONLY) {
    console.log("\n[1/3] Sync landing KPIs from public JSON…");
    landing = await syncLandingFromUrl();
    console.log(`  ${landing.totalsPath}`);
    console.log(`  ${landing.historyPath}`);
    for (const f of landing.topFiles) {
      console.log(`  ${f.path} (${f.rows} rows)`);
    }

    if (!WEEKLY_ONLY) {
      const missingGrant = [];
      for (const spec of TABLE_UPLOADS.filter((t) => t.group === "grant")) {
        if (!(await fileExists(resolveTablePath(spec)))) missingGrant.push(spec.file);
      }
      if (missingGrant.length) {
        console.warn(
          "\n  Grant CSVs missing (run Phase 1 first):\n  " +
            missingGrant.map((f) => `npm run stats:export-dune-grant  # creates ${f}`).join("\n  ")
        );
      }
    }
  } else {
    console.log("\n[1/3] Skipped landing sync (--queries-only)");
  }

  const state = await loadState();

  let uploads = [];
  let namespace = state.namespace || process.env.DUNE_NAMESPACE || null;
  if (!QUERIES_ONLY) {
    console.log("\n[2/3] Upload tables to Dune…");
    const result = await uploadTables(state);
    uploads = result.uploads;
    namespace = result.namespace || namespace;
  } else {
    console.log("\n[2/3] Skipped table upload (--queries-only)");
  }

  let queryResults = [];
  if (!SKIP_QUERIES && namespace) {
    console.log("\n[3/3] Create/update Dune queries…");
    queryResults = await upsertQueries(state, namespace);
  } else if (SKIP_QUERIES) {
    console.log("\n[3/3] Skipped queries (--skip-queries)");
  } else {
    console.log("\n[3/3] Skipped queries (no namespace)");
  }

  if (!DRY_RUN) await saveState(state);
  printSummary({ landing, uploads, namespace, queryResults, state });
}

main().catch((err) => {
  console.error("\nDune publish failed:", err.message || err);
  if (err instanceof DuneApiError && err.body) {
    console.error(JSON.stringify(err.body, null, 2));
  }
  process.exit(1);
});
