/**
 * Weekly Dune sync — landing JSON only, zero Railway Redis / app egress.
 * Updates platform KPIs + pool summary platform columns; keeps last on-chain CSV sums.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  console.log("SwapArc weekly Dune sync (no Redis egress)\n");
  await run("node", ["scripts/refreshDuneGrantSummaries.mjs"]);
  await run("node", ["scripts/uploadDuneGrantSummaries.mjs"]);
  console.log("\n(Optional) Leaderboards: run stats:export-dune-all-profiles locally, then stats:upload-dune-profiles");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
