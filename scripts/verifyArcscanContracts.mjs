/**
 * Verify Swaparc contracts on Arcscan (Blockscout) via standard-json input.
 * Usage: node scripts/verifyArcscanContracts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import solc from "solc";
import { ARC_TOKEN_ADDRESSES, LP_POOLS } from "../lib/lpPoolsConfig.js";
import {
  CANONICAL_SWAP_POOL_ADDRESS,
  SWAP_POOL_TOKENS,
  DEFAULT_POOL_A,
  DEFAULT_POOL_FEE_BPS,
} from "../lib/swapPoolConfig.js";

const ARCSCAN = "https://testnet.arcscan.app";
const ROOT = process.cwd();
const DEPLOYMENT = JSON.parse(
  fs.readFileSync("data/deployments/swap-pool-v2.latest.json", "utf8")
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}, retries = 5) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { status: res.status, ok: res.ok, json, text };
    } catch (e) {
      lastErr = e;
      console.log(`  fetch retry ${i + 1}/${retries}: ${e.cause?.code || e.message}`);
      await sleep(3000 * (i + 1));
    }
  }
  throw lastErr;
}

function collectSources(entryFiles) {
  const sources = {};
  const queue = [...entryFiles];
  const seen = new Set();

  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);

    let abs = rel.startsWith("@")
      ? path.join(ROOT, "node_modules", rel)
      : path.join(ROOT, rel.includes("/") ? rel : path.join("contracts", rel));
    if (!fs.existsSync(abs)) abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`Missing source: ${rel}`);

    const content = fs.readFileSync(abs, "utf8");
    const key = rel.startsWith("@") ? rel : path.basename(rel);
    sources[key] = { content };

    const importRe = /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(content))) {
      const imp = m[1];
      if (imp.startsWith("@")) queue.push(imp);
      else if (imp.startsWith("./") || imp.startsWith("../")) {
        const resolved = path
          .normalize(path.join(path.dirname(abs), imp))
          .replace(/\\/g, "/");
        const fromRoot = path.relative(ROOT, resolved).replace(/\\/g, "/");
        queue.push(
          fromRoot.startsWith("node_modules/")
            ? fromRoot.slice("node_modules/".length)
            : fromRoot
        );
      } else queue.push(imp);
    }
  }
  return sources;
}

function buildStandardJson(sources, { optimizer, runs = 200 }) {
  return {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: !!optimizer, runs },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
        },
      },
    },
  };
}

async function getStatus(address) {
  const r = await fetchJson(`${ARCSCAN}/api/v2/smart-contracts/${address}`);
  if (!r.ok) return { is_verified: false };
  return r.json;
}

function isVerified(st) {
  return !!(st?.is_verified || st?.is_fully_verified);
}

async function submitStandardInput({
  address,
  compilerVersion,
  contractName,
  standardJson,
  constructorArgsHex = "",
  autodetect = true,
  license = "mit",
}) {
  const url = `${ARCSCAN}/api/v2/smart-contracts/${address}/verification/via/standard-input`;
  const form = new FormData();
  form.append("compiler_version", compilerVersion);
  form.append("contract_name", contractName);
  form.append("license_type", license);
  form.append("autodetect_constructor_args", autodetect ? "true" : "false");
  if (!autodetect && constructorArgsHex) {
    const args = constructorArgsHex.startsWith("0x")
      ? constructorArgsHex.slice(2)
      : constructorArgsHex;
    form.append("constructor_args", args);
  }
  form.append(
    "files[0]",
    new Blob([JSON.stringify(standardJson)], { type: "application/json" }),
    "standard-input.json"
  );
  return fetchJson(url, { method: "POST", body: form });
}

async function waitVerified(address, label, tries = 16) {
  for (let i = 0; i < tries; i++) {
    await sleep(4000);
    const st = await getStatus(address);
    console.log(
      `  poll ${i + 1}/${tries} ${label}: verified=${isVerified(st)} name=${st.name || "-"} fully=${!!st.is_fully_verified}`
    );
    if (isVerified(st)) return st;
  }
  return getStatus(address);
}

function encodePoolCtor(tokenSymbols) {
  const addrs = tokenSymbols.map((s) => ethers.getAddress(ARC_TOKEN_ADDRESSES[s]));
  return ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [addrs]);
}

function encodeLpCtor(poolAddress) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["address"],
    [ethers.getAddress(poolAddress)]
  );
}

async function sourcesFromVerifiedTwin(twinAddress) {
  const st = await getStatus(twinAddress);
  if (!isVerified(st)) throw new Error(`Twin ${twinAddress} not verified`);
  const sources = {};
  sources[st.file_path || "SwaparcPoolV2.sol"] = { content: st.source_code };
  for (const extra of st.additional_sources || []) {
    sources[extra.file_path] = { content: extra.source_code };
  }
  return {
    sources,
    compilerVersion: st.compiler_version?.startsWith("v")
      ? st.compiler_version
      : `v${st.compiler_version}`,
    optimizer: !!st.optimization_enabled,
    runs: st.optimization_runs || 200,
  };
}

async function verifyOne({
  address,
  label,
  compilerVersion,
  contractName,
  standardJson,
  constructorArgsHex,
  autodetect = false,
}) {
  const before = await getStatus(address);
  if (isVerified(before) && before.name && before.name !== "StubContract") {
    console.log(`\nSKIP already verified: ${label} (${before.name})`);
    return { label, address, verified: true, name: before.name, skipped: true };
  }
  console.log(`\nVerifying ${label} ${address}`);
  const sub = await submitStandardInput({
    address,
    compilerVersion,
    contractName,
    standardJson,
    constructorArgsHex,
    autodetect,
  });
  console.log(`  submit: ${sub.status} ${JSON.stringify(sub.json).slice(0, 250)}`);
  const st = await waitVerified(address, label);
  return {
    label,
    address,
    verified: isVerified(st),
    name: st.name,
    fully: !!st.is_fully_verified,
  };
}

async function main() {
  const solcFull = solc.version();
  const match = solcFull.match(/^(\d+\.\d+\.\d+\+commit\.[0-9a-f]+)/i);
  const compiler35 = match ? `v${match[1]}` : "v0.8.35+commit.47b9dedd";
  console.log("Local solc:", solcFull);
  console.log("API compiler:", compiler35);

  const results = [];

  // Current LP sources (0.8.35 / opt off) — CircBTC pools + LP tokens
  const lpSources = collectSources([
    "contracts/SwaparcPoolV2.sol",
    "contracts/SwaparcLP.sol",
  ]);
  const lpStandard35 = buildStandardJson(lpSources, { optimizer: false });

  const circPools = LP_POOLS.filter((p) => p.id.includes("circbtc"));
  const legacyPools = LP_POOLS.filter((p) => !p.id.includes("circbtc"));

  for (const pool of circPools) {
    results.push(
      await verifyOne({
        address: pool.poolAddress,
        label: `pool-${pool.id}`,
        compilerVersion: compiler35,
        contractName: "SwaparcPoolV2.sol:SwaparcPoolV2",
        standardJson: lpStandard35,
        constructorArgsHex: encodePoolCtor(pool.tokens),
      })
    );
    results.push(
      await verifyOne({
        address: pool.lpToken,
        label: `lp-${pool.id}`,
        compilerVersion: compiler35,
        contractName: "SwaparcLP.sol:SwaparcLP",
        standardJson: lpStandard35,
        constructorArgsHex: encodeLpCtor(pool.poolAddress),
      })
    );
  }

  // Legacy LP tokens: reuse exact sources from already-verified pool twin
  console.log("\n--- Legacy LP tokens via verified twin sources ---");
  const twin = await sourcesFromVerifiedTwin(legacyPools[0].poolAddress);
  const twinStandard = buildStandardJson(twin.sources, {
    optimizer: twin.optimizer,
    runs: twin.runs,
  });
  for (const pool of legacyPools) {
    results.push(
      await verifyOne({
        address: pool.lpToken,
        label: `lp-${pool.id}`,
        compilerVersion: twin.compilerVersion.includes("0.8.20")
          ? twin.compilerVersion
          : "v0.8.20+commit.a1b79de6",
        contractName: "SwaparcLP.sol:SwaparcLP",
        standardJson: twinStandard,
        constructorArgsHex: encodeLpCtor(pool.poolAddress),
      })
    );
  }

  // Swap pool implementation
  const stableSources = collectSources(["contracts/StableSwapPoolV2.sol"]);
  const stableStandard = buildStandardJson(stableSources, {
    optimizer: true,
    runs: 200,
  });
  results.push(
    await verifyOne({
      address: DEPLOYMENT.implementation,
      label: "swap-impl",
      compilerVersion: compiler35,
      contractName: "StableSwapPoolV2.sol:StableSwapPoolV2",
      standardJson: stableStandard,
      autodetect: true,
    })
  );

  // Swap pool proxy
  const proxySol = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SwaparcStableSwapProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
`;
  const tmpProxy = path.join(ROOT, "contracts", "_tmpProxy.sol");
  fs.writeFileSync(tmpProxy, proxySol);
  let proxySources;
  try {
    proxySources = collectSources(["contracts/_tmpProxy.sol"]);
    // rename key
    if (proxySources["_tmpProxy.sol"]) {
      proxySources["SwaparcStableSwapProxy.sol"] = proxySources["_tmpProxy.sol"];
      delete proxySources["_tmpProxy.sol"];
    }
  } finally {
    try {
      fs.unlinkSync(tmpProxy);
    } catch {
      /* ignore */
    }
  }
  const proxyStandard = buildStandardJson(proxySources, { optimizer: true, runs: 200 });

  // Pull constructor args from creation tx input if possible
  const proxyAddress = DEPLOYMENT.proxy || CANONICAL_SWAP_POOL_ADDRESS;
  let proxyCtor = "";
  try {
    const addrInfo = await fetchJson(`${ARCSCAN}/api/v2/addresses/${proxyAddress}`);
    const txHash = addrInfo.json?.creation_transaction_hash;
    if (txHash) {
      const tx = await fetchJson(`${ARCSCAN}/api/v2/transactions/${txHash}`);
      const input = tx.json?.raw_input || tx.json?.input || "";
      // constructor args are after creation bytecode — use autodetect primarily
      console.log(`  proxy creation tx ${txHash}, input len ${input.length}`);
    }
  } catch (e) {
    console.log("  proxy creation lookup failed:", e.message);
  }

  // Try reconstruct: need ORIGINAL implementation from first deploy, not upgraded one.
  // Prefer autodetect.
  results.push(
    await verifyOne({
      address: proxyAddress,
      label: "swap-proxy",
      compilerVersion: compiler35,
      contractName: "SwaparcStableSwapProxy.sol:SwaparcStableSwapProxy",
      standardJson: proxyStandard,
      autodetect: true,
      constructorArgsHex: proxyCtor,
    })
  );

  // If proxy still only partial, try with explicit reconstructed args using superseded note
  const proxyFinal = results[results.length - 1];
  if (!proxyFinal.fully && isVerified(await getStatus(proxyAddress))) {
    // already partial from bytecode db — try force with known pattern
    const iface = new ethers.Interface([
      "function initialize(address[] tokens, uint256 A, uint256 feeBps)",
    ]);
    // Without original impl address verification of custom proxy wrapper may fail;
    // partial ERC1967 match is already on explorer.
    void iface;
    void SWAP_POOL_TOKENS;
    void DEFAULT_POOL_A;
    void DEFAULT_POOL_FEE_BPS;
  }

  console.log("\n========== VERIFICATION SUMMARY ==========");
  for (const r of results) {
    const mark = r.verified ? "OK  " : "FAIL";
    console.log(
      `${mark} | ${String(r.label).padEnd(22)} | ${r.address} | ${r.name || "-"} ${r.skipped ? "(skipped)" : ""}`
    );
  }
  const failed = results.filter((r) => !r.verified);
  console.log(
    failed.length
      ? `\n${failed.length} still unverified.`
      : "\nAll targeted contracts verified."
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
