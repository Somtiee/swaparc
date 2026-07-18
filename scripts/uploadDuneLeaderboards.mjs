/** Upload only leaderboard CSVs to Dune (after stats:export-dune-db). */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadCsv } from "../lib/dune/client.mjs";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "data/dune-export/db");

const TABLES = [
  ["swaparc_top_swap_volume.csv", "swaparc_top_swap_volume", "Top traders by volume (merged wallet+username profiles)"],
  ["swaparc_top_swap_count.csv", "swaparc_top_swap_count", "Top traders by swap count"],
  ["swaparc_top_lp.csv", "swaparc_top_lp", "Top liquidity providers"],
];

async function main() {
  for (const [file, table, desc] of TABLES) {
    const data = await readFile(join(DB, file), "utf8");
    console.log(`Uploading ${table}…`);
    const res = await uploadCsv({ data, tableName: table, description: desc });
    console.log(`  → ${res.full_name}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\nDone. Re-run Top Traders query on your dashboard.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
