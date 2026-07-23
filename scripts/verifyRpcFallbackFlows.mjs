/**
 * Live verification: public → dRPC → Alchemy reads for PrivPay / Swap / Pools.
 * Usage: node scripts/verifyRpcFallbackFlows.mjs
 *
 * Does NOT send transactions. Simulates the exact eth_calls Pay Now / recurring /
 * swap quotes / LP reads rely on, and asserts fallback works when free RPCs flake.
 */
import "dotenv/config";
import { ethers } from "ethers";
import {
  createArcJsonRpcProvider,
  getArcRpcUrls,
  withArcRpc,
} from "../lib/server/arcRpc.js";

const WALLET = (
  process.env.VERIFY_WALLET ||
  process.env.SWAP_POOL_OWNER_ADDRESS ||
  "0xD4d3E342902766344075D06c94391e61A9bB7e60"
).toLowerCase();

const USDC = "0x3600000000000000000000000000000000000000";
const TOKENS = {
  USDC,
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
};

const POOLS = {
  USDC:
    process.env.VITE_PRIVACY_POOL_ADDRESS_USDC ||
    process.env.VITE_PRIVACY_POOL_ADDRESS ||
    "",
  EURC: process.env.VITE_PRIVACY_POOL_ADDRESS_EURC || "",
  SWPRC: process.env.VITE_PRIVACY_POOL_ADDRESS_SWPRC || "",
};

const STEALTH = process.env.VITE_STEALTH_PAYMENTS_ADDRESS || "";
const SWAP_POOL =
  process.env.VITE_SWAP_POOL_ADDRESS ||
  process.env.SWAP_POOL_ADDRESS ||
  "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560";
const RECURRING =
  process.env.VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
  process.env.RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
  "";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const POOL_ABI = [
  "function token() view returns (address)",
  "function currentRoot() view returns (bytes32)",
  "function deposit(bytes32 commitment, uint256 amount)",
];
const SWAP_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function getBalances() view returns (uint256[])",
];
const RECURRING_ABI = [
  "function authorizations(bytes32) view returns (address payer, address executor, address token, address pool, uint128 maxAmountPerExecution, uint128 maxAmountPerPeriod, uint128 spentInPeriod, uint64 periodSeconds, uint64 periodWindowStart, bool active)",
];

const results = [];
function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  const detail = String(err?.message || err).slice(0, 200);
  results.push({ name, ok: false, detail });
  console.error(`  FAIL  ${name} — ${detail}`);
}

async function perRpc(label, fn) {
  const urls = getArcRpcUrls();
  const out = [];
  for (const url of urls) {
    const short = url.includes("alchemy")
      ? "alchemy"
      : url.includes("drpc")
        ? "drpc"
        : "public";
    try {
      const provider = createArcJsonRpcProvider(url);
      const started = Date.now();
      const value = await Promise.race([
        fn(provider, url),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout 5s")), 5000)
        ),
      ]);
      out.push({ short, ok: true, ms: Date.now() - started, value });
    } catch (e) {
      out.push({ short, ok: false, err: String(e?.message || e).slice(0, 120) });
    }
  }
  const healthy = out.filter((r) => r.ok).length;
  if (healthy === 0) throw new Error(`all RPCs failed for ${label}`);
  return out;
}

async function main() {
  console.log("\n=== SwapArc RPC fallback verification ===");
  console.log(`wallet: ${WALLET}`);
  console.log(`rpcs:   ${getArcRpcUrls().map((u) => (u.includes("alchemy") ? "alchemy" : u.includes("drpc") ? "drpc" : "public")).join(" → ")}`);

  // 1) Block number on each RPC + withArcRpc
  console.log("\n[1] Chain head");
  try {
    const rows = await perRpc("blockNumber", (p) => p.getBlockNumber());
    pass(
      "blockNumber per-RPC",
      rows.map((r) => `${r.short}:${r.ok ? r.value : "FAIL"}`).join(" ")
    );
    const n = await withArcRpc((p) => p.getBlockNumber(), "blockNumber");
    pass("withArcRpc blockNumber", String(n));
  } catch (e) {
    fail("blockNumber", e);
  }

  // 2) Token reads used by Pay Now / Pools / Swap
  console.log("\n[2] ERC-20 allowance / decimals / balance (Pay Now + LP)");
  for (const [sym, token] of Object.entries(TOKENS)) {
    if (!token) continue;
    const spenders = [STEALTH, POOLS[sym], SWAP_POOL].filter(Boolean);
    for (const spender of spenders) {
      const name = `${sym}.allowance→${spender.slice(0, 8)}`;
      try {
        const v = await withArcRpc(
          (p) =>
            new ethers.Contract(token, ERC20_ABI, p).allowance(WALLET, spender),
          name
        );
        pass(name, v.toString());
      } catch (e) {
        fail(name, e);
      }
    }
    try {
      const dec = await withArcRpc(
        (p) => new ethers.Contract(token, ERC20_ABI, p).decimals(),
        `${sym}.decimals`
      );
      const bal = await withArcRpc(
        (p) => new ethers.Contract(token, ERC20_ABI, p).balanceOf(WALLET),
        `${sym}.balanceOf`
      );
      pass(`${sym}.decimals+balance`, `${dec} / ${ethers.formatUnits(bal, dec)}`);
    } catch (e) {
      fail(`${sym}.decimals+balance`, e);
    }
  }

  // 3) Privacy pools (Bills + Payroll ZK rail + claims root)
  console.log("\n[3] Privacy pools (Pay Now / recurring / claims)");
  for (const [sym, pool] of Object.entries(POOLS)) {
    if (!pool) {
      fail(`pool.${sym}`, "missing env address");
      continue;
    }
    try {
      const code = await withArcRpc((p) => p.getCode(pool), `pool.${sym}.code`);
      const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
      if (bytes < 1000) throw new Error(`truncated code ${bytes} bytes`);
      const tokenAddr = await withArcRpc(
        (p) => new ethers.Contract(pool, POOL_ABI, p).token(),
        `pool.${sym}.token`
      );
      const root = await withArcRpc(
        (p) => new ethers.Contract(pool, POOL_ABI, p).currentRoot(),
        `pool.${sym}.root`
      );
      const expected = ethers.getAddress(TOKENS[sym]);
      if (ethers.getAddress(tokenAddr) !== expected) {
        throw new Error(`token mismatch ${tokenAddr} != ${expected}`);
      }
      pass(`pool.${sym}`, `code=${bytes}b root=${String(root).slice(0, 12)}…`);

      // Simulate deposit staticCall the way Pay Now now does (from wallet).
      // Expect revert (no real commitment) OR success path via RPC — either proves eth_call works.
      const fakeCommitment = ethers.ZeroHash;
      const amount = 1n;
      try {
        await withArcRpc(
          (p) =>
            new ethers.Contract(pool, POOL_ABI, p).deposit.staticCall(
              fakeCommitment,
              amount,
              { from: WALLET }
            ),
          `pool.${sym}.depositSim`
        );
        pass(`pool.${sym}.depositSim`, "unexpected success (ok — RPC works)");
      } catch (simErr) {
        const msg = String(simErr?.message || simErr);
        if (/missing revert data|could not coalesce|timeout|rate limit|-32011/i.test(msg)) {
          fail(`pool.${sym}.depositSim`, simErr);
        } else {
          // Contract revert / TransferInFailed / AmountZero etc. means RPC delivered a real answer.
          pass(
            `pool.${sym}.depositSim`,
            `contract answer via RPC (${(simErr?.revert?.name || "revert").toString()})`
          );
        }
      }
    } catch (e) {
      fail(`pool.${sym}`, e);
    }
  }

  // 4) Stealth contract code
  console.log("\n[4] Stealth payments (non-ZK Pay Now)");
  if (!STEALTH) fail("stealth", "missing VITE_STEALTH_PAYMENTS_ADDRESS");
  else {
    try {
      const code = await withArcRpc((p) => p.getCode(STEALTH), "stealth.code");
      const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
      if (bytes < 100) throw new Error(`no/truncated code ${bytes}`);
      pass("stealth.code", `${bytes} bytes`);
    } catch (e) {
      fail("stealth.code", e);
    }
  }

  // 5) Swap quotes + balances (Swap UX)
  console.log("\n[5] Swap pool quotes");
  try {
    const dy = await withArcRpc(
      (p) =>
        new ethers.Contract(SWAP_POOL, SWAP_ABI, p).get_dy(
          0,
          1,
          ethers.parseUnits("1", 6)
        ),
      "swap.get_dy"
    );
    const bals = await withArcRpc(
      (p) => new ethers.Contract(SWAP_POOL, SWAP_ABI, p).getBalances(),
      "swap.getBalances"
    );
    pass(
      "swap.get_dy+balances",
      `1 USDC→EURC dy=${ethers.formatUnits(dy, 6)} reserves=${bals.length}`
    );
  } catch (e) {
    fail("swap.get_dy+balances", e);
  }

  // 6) Recurring automation contract
  console.log("\n[6] Recurring automation (Bills + Payroll autopay)");
  if (!RECURRING) fail("recurring", "missing contract address");
  else {
    try {
      const code = await withArcRpc((p) => p.getCode(RECURRING), "recurring.code");
      const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
      if (bytes < 100) throw new Error(`no code ${bytes}`);
      const authId = ethers.id("verify-read");
      await withArcRpc(
        (p) =>
          new ethers.Contract(RECURRING, RECURRING_ABI, p).authorizations(authId),
        "recurring.authorizations"
      );
      pass("recurring.authorizations", `code=${bytes}b`);
    } catch (e) {
      fail("recurring", e);
    }
  }

  // 7) Forced fallback: poison public-looking call then ensure withArcRpc still works
  console.log("\n[7] Fallback resilience (dRPC/Alchemy must cover public flakes)");
  try {
    const v = await withArcRpc(async (p, url) => {
      if (url.includes("rpc.testnet.arc.network")) {
        throw new Error("missing revert data (simulated public flake)");
      }
      return p.getBlockNumber();
    }, "forced-fallback");
    pass("forced-fallback skips flaky public", `head=${v}`);
  } catch (e) {
    fail("forced-fallback", e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Summary ===");
  console.log(`passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.error("failures:");
    for (const f of failed) console.error(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("All RPC fallback checks passed for PrivPay / Swap / Pools reads.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
