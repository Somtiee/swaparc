/**
 * Windows-friendly PRIVPAY ZK setup (no global circom install):
 * 1) Download circom 2.x exe into tools/circom.exe (if missing)
 * 2) Compile circuits/privpay/privpay_claim.circom → build/privpay/*.r1cs + wasm
 * 3) Run a **local dev-only** snarkjs Groth16 ceremony (NOT a production MPC)
 * 4) Write build/privpay/verification_key.json + privpay_claim_final.zkey
 * 5) Copy wasm + zkey → public/circuits/privpay/ for VITE_PRIVPAY_* URLs
 *
 * Then: npm run deploy:pool
 *
 * Usage: node scripts/setupPrivpayZkArtifacts.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import https from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "build", "privpay");
const publicDir = path.join(root, "public", "circuits", "privpay");
const toolsDir = path.join(root, "tools");
const circomExe = path.join(toolsDir, "circom.exe");
const circuit = path.join(root, "circuits", "privpay", "privpay_claim.circom");
const circomLib = path.join(root, "node_modules", "circomlib", "circuits");

/** Hermez Phase-1 final ptau (public ceremony). Large downloads; try smallest that fits your circuit. */
const PTAU_URLS = [
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau",
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_18.ptau",
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau",
];

const CIRCOM_DOWNLOAD =
  "https://github.com/iden3/circom/releases/download/v2.2.2/circom-windows-amd64.exe";

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`Command failed (${label}): ${cmd} ${args.join(" ")}`);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const opts = {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; swaparc-setup/1.0)",
        Accept: "*/*",
      },
    };
    const req = https.get(url, opts, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        file.close();
        fs.unlinkSync(dest);
        if (!loc) return reject(new Error("Redirect without location"));
        return downloadFile(loc, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });
    req.on("error", (e) => {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      reject(e);
    });
    req.end();
  });
}

async function ensureCircom() {
  if (process.platform !== "win32") {
    const which = spawnSync("which", ["circom"], { encoding: "utf8" });
    if (which.status === 0 && which.stdout?.trim()) {
      console.log("Using circom from PATH");
      return "circom";
    }
  }
  fs.mkdirSync(toolsDir, { recursive: true });
  if (fs.existsSync(circomExe)) {
    console.log("Using", circomExe);
    return circomExe;
  }
  if (process.platform !== "win32") {
    throw new Error("Install circom 2.x on PATH, or use Windows for auto-download of circom.exe.");
  }
  console.log("Downloading circom from", CIRCOM_DOWNLOAD);
  const tmp = circomExe + ".download";
  await downloadFile(CIRCOM_DOWNLOAD, tmp);
  fs.renameSync(tmp, circomExe);
  console.log("Saved", circomExe);
  return circomExe;
}

function compileBin(circom) {
  fs.mkdirSync(outDir, { recursive: true });
  run("circom compile", circom, [
    circuit,
    "--r1cs",
    "--wasm",
    "-o",
    outDir,
    "-l",
    circomLib,
  ]);
}

function parseConstraintCount(infoText) {
  const m = /Constraints:\s*(\d+)/i.exec(infoText);
  return m ? Number(m[1]) : null;
}

function runSnark(args) {
  run(`snarkjs ${args[0]}`, "npx", ["snarkjs", ...args]);
}

function buildLocalFinalPtau(power) {
  const pot0 = path.join(outDir, `pot${power}_0000.ptau`);
  const pot1 = path.join(outDir, `pot${power}_0001.ptau`);
  const potFinal = path.join(outDir, `pot${power}_final.ptau`);
  const e1 = randomBytes(16).toString("hex");
  const e2 = randomBytes(16).toString("hex");
  runSnark(["powersoftau", "new", "bn128", String(power), pot0, "-v"]);
  runSnark([
    "powersoftau",
    "contribute",
    pot0,
    pot1,
    "-n=swaparc-local",
    `-e=${e1}`,
    "-v",
  ]);
  runSnark(["powersoftau", "prepare", "phase2", pot1, potFinal, "-v"]);
  return potFinal;
}

async function tryGrothSetupWithPtau(ptauPath) {
  const r1cs = path.join(outDir, "privpay_claim.r1cs");
  const zkey0 = path.join(outDir, "privpay_claim_000.zkey");
  const zkey1 = path.join(outDir, "privpay_claim_final.zkey");
  const vkPath = path.join(outDir, "verification_key.json");

  runSnark(["groth16", "setup", r1cs, ptauPath, zkey0]);
  const entropy = createHash("sha256").update(randomBytes(32)).digest("hex");
  runSnark([
    "zkey",
    "contribute",
    zkey0,
    zkey1,
    "-n=swaparc-dev",
    `-e=${entropy}`,
    "-v",
  ]);
  runSnark(["zkey", "export", "verificationkey", zkey1, vkPath]);
  return { zkey1, vkPath };
}

async function main() {
  const circom = await ensureCircom();
  compileBin(circom);

  const r1csPath = path.join(outDir, "privpay_claim.r1cs");
  if (!fs.existsSync(r1csPath)) {
    throw new Error(`Missing ${r1csPath} after circom`);
  }

  const infoBuf = spawnSync("npx", ["snarkjs", "r1cs", "info", r1csPath], {
    cwd: root,
    shell: true,
    encoding: "utf8",
  });
  const infoTxt = `${infoBuf.stdout || ""}\n${infoBuf.stderr || ""}`;
  const nConstraints = parseConstraintCount(infoTxt) ?? null;
  if (nConstraints != null) {
    console.log(`\nCircuit constraints: ${nConstraints}`);
  }

  const wasmGlob = path.join(outDir, "privpay_claim_js", "privpay_claim.wasm");
  const wasmFlat = path.join(outDir, "privpay_claim.wasm");
  const wasmSrc = fs.existsSync(wasmGlob) ? wasmGlob : wasmFlat;
  if (!fs.existsSync(wasmSrc)) {
    throw new Error(`WASM not found at ${wasmGlob} or ${wasmFlat}`);
  }

  let lastErr = null;
  for (const url of PTAU_URLS) {
    const name = path.basename(new URL(url).pathname);
    const ptauPath = path.join(outDir, name);
    if (!fs.existsSync(ptauPath)) {
      console.log(`\nDownloading ${name} (large file, one-time)…`);
      try {
        await downloadFile(url, ptauPath);
      } catch (e) {
        lastErr = e;
        console.warn("Download failed:", e.message);
        continue;
      }
    }
    try {
      await tryGrothSetupWithPtau(ptauPath);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.warn("groth16 setup with this ptau failed:", e.message);
    }
  }

  if (lastErr) {
    console.warn(
      "\nPublic ptau mirrors failed (403 / network). Running **local dev** Powers of Tau (bn128, power 18) — fine for testnet only.\n"
    );
    const localPtau = buildLocalFinalPtau(18);
    await tryGrothSetupWithPtau(localPtau);
  }

  fs.mkdirSync(publicDir, { recursive: true });
  const zFinal = path.join(outDir, "privpay_claim_final.zkey");
  const wasmDest = path.join(publicDir, "privpay_claim.wasm");
  const zkeyDest = path.join(publicDir, "privpay_claim_final.zkey");
  const vkSrc = path.join(outDir, "verification_key.json");
  const vkDest = path.join(publicDir, "verification_key.json");
  fs.copyFileSync(wasmSrc, wasmDest);
  fs.copyFileSync(zFinal, zkeyDest);
  if (fs.existsSync(vkSrc)) fs.copyFileSync(vkSrc, vkDest);
  console.log("\nCopied proving files to", publicDir);
  console.log("Created", path.join(outDir, "verification_key.json"));
  console.log("\nNext: npm run deploy:pool");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
