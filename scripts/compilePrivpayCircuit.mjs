/**
 * Compile privpay_claim.circom → build/privpay/*.r1cs, *.wasm
 * Requires circom 2.x on PATH: https://docs.circom.io/getting-started/installation
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "build", "privpay");
const circuit = path.join(root, "circuits", "privpay", "privpay_claim.circom");
const circomLib = path.join(root, "node_modules", "circomlib", "circuits");

fs.mkdirSync(outDir, { recursive: true });

const r = spawnSync(
  "circom",
  [circuit, "--r1cs", "--wasm", "-o", outDir, "-l", circomLib],
  { stdio: "inherit", shell: true }
);
if (r.error || r.status !== 0) {
  console.error(
    "\nInstall circom (2.x) and ensure it is on PATH, then re-run:\n" +
      "  npm run circuit:privpay:compile\n"
  );
  process.exit(r.status ?? 1);
}
console.log("Compiled to", outDir);
