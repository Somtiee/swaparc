/** Upload full profile leaderboard CSV to Dune. */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadCsv } from "../lib/dune/client.mjs";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "data/dune-export/db");

async function main() {
  const data = await readFile(join(DB, "swaparc_all_profiles.csv"), "utf8");
  const sizeMb = (Buffer.byteLength(data, "utf8") / (1024 * 1024)).toFixed(2);
  console.log(`Uploading swaparc_all_profiles (${sizeMb} MB)…`);
  const res = await uploadCsv({
    data,
    tableName: "swaparc_all_profiles",
    description:
      "All SwapArc trader profiles ranked by volume and LP (merged wallet+username). Searchable on Dune dashboard.",
  });
  console.log(`  → ${res.full_name}`);
  console.log("\nDone. Run: npm run stats:fix-dune-queries");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
