/** Upload grant summary + V2 swap + privpay tables after refresh (no 8M legacy file). */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadCsv } from "../lib/dune/client.mjs";

const GRANT = join(dirname(fileURLToPath(import.meta.url)), "..", "data/dune-export/grant");
const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "data/dune-export/db");

const TABLES = [
  [join(DB, "swaparc_network_totals.csv"), "swaparc_network_totals", "Landing KPIs (matches swaparc.app)"],
  [join(GRANT, "swaparc_swap_pool_total.csv"), "swaparc_swap_pool_total", "Pool segments with platform + on-chain volume"],
  [join(GRANT, "swaparc_old_swap_pool_summary.csv"), "swaparc_old_swap_pool_summary", "Legacy pool summary"],
  [join(GRANT, "swaparc_new_swap_pool.csv"), "swaparc_new_swap_pool", "V2 swaps with get_dy volume"],
  [join(GRANT, "swaparc_privpay.csv"), "swaparc_privpay", "PrivPay USDC/EURC/SWPRC"],
  [join(GRANT, "swaparc_lp_pools.csv"), "swaparc_lp_pools", "LP pool TVL (matches landing page)"],
];

async function main() {
  for (const [path, table, desc] of TABLES) {
    const data = await readFile(path, "utf8");
    const mb = (Buffer.byteLength(data, "utf8") / (1024 * 1024)).toFixed(2);
    console.log(`Upload ${table} (${mb} MB)…`);
    const res = await uploadCsv({ data, tableName: table, description: desc });
    console.log(`  → ${res.full_name}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\nDone. Run: npm run stats:fix-dune-queries");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
