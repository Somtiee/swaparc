// Deep-dive diagnostic for the swap pool revert. Read-only RPC calls.
import { ethers } from "ethers";
import { config } from "dotenv";

config();

const RPCS = [
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  "https://arc-testnet.drpc.org",
].filter(Boolean);

const POOL = "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560";
const ABI = [
  "function paused() view returns (bool)",
  "function tokens(uint256) view returns (address)",
  "function balances(uint256) view returns (uint256)",
  "function getBalances() view returns (uint256[])",
  "function A() view returns (uint256)",
  "function fee() view returns (uint256)",
  "function getTokenCount() view returns (uint256)",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function owner() view returns (address)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)",
  "function getRates() view returns (uint256[])",
];
const ERC20 = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];

async function tryRpc(label, fn) {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
      return { url, result: await fn(p) };
    } catch (e) {
      console.log(`  [${label}] ${url} -> ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  throw new Error(`all RPCs failed for ${label}`);
}

const out = {};

// 1. Basic pool state
const { url: usedUrl } = await tryRpc("pool", async (p) => {
  const pool = new ethers.Contract(POOL, ABI, p);
  const paused = await pool.paused();
  const A = await pool.A();
  const fee = await pool.fee();
  const owner = await pool.owner();
  const count = await pool.getTokenCount().catch(() => null);
  const balances = await pool.getBalances();
  const rates = await pool.getRates().catch(() => null);
  const tokens = [];
  for (let i = 0; i < balances.length; i++) {
    tokens.push(await pool.tokens(i));
  }
  Object.assign(out, { paused, A: A.toString(), fee: fee.toString(), owner, tokenCount: count?.toString(), balances: balances.map((b) => b.toString()), rates: rates?.map((r) => r.toString()), tokens });
});
console.log(`\n=== POOL STATE (via ${usedUrl}) ===`);
console.log(JSON.stringify(out, null, 2));

// 2. Token inspection: code presence + metadata
console.log(`\n=== TOKENS ON POOL ===`);
for (const [i, token] of out.tokens.entries()) {
  const code = await tryRpc(`code[${i}]`, (p) => p.getCode(token)).then((r) => r.result);
  const hasCode = code && code !== "0x";
  let meta = "NO CODE (native token address!)";
  if (hasCode) {
    meta = await tryRpc(`meta[${i}]`, async (p) => {
      const c = new ethers.Contract(token, ERC20, p);
      const symbol = await c.symbol().catch(() => "?");
      const decimals = await c.decimals().catch(() => "?");
      return `${symbol} (${decimals} dec)`;
    }).then((r) => r.result).catch((e) => `metadata failed: ${e.message}`);
  }
  console.log(`  [${i}] ${token} -> ${hasCode ? "has code" : "NO CODE"} | ${meta} | pool balance: ${out.balances[i]}`);
}

// 3. Simulate the exact swap the app sends, to capture the revert reason
console.log(`\n=== SIMULATED SWAPS (eth_call, from zero-allowance address) ===`);
const from = "0x000000000000000000000000000000000000dEaD";
for (const [i, ti] of out.tokens.entries()) {
  for (const [j, tj] of out.tokens.entries()) {
    if (i === j) continue;
    // get_dy first
    const dy = await tryRpc(`get_dy`, (p) =>
      new ethers.Contract(POOL, ABI, p).get_dy(i, j, 1_000_000n)
    ).then((r) => r.result).catch((e) => `get_dy REVERT: ${e.info?.error?.message || e.shortMessage || e.message?.slice(0, 100)}`);
    // raw eth_call of swap to surface revert data
    const iface = new ethers.Interface(ABI);
    const data = iface.encodeFunctionData("swap", [i, j, 1_000_000n]);
    const raw = await tryRpc(`swapcall`, async (p) =>
      p.send("eth_call", [{ from, to: POOL, data }, "latest"])
    ).then((r) => r.result).catch(async (e) => {
      // Re-throw with the raw revert data attached
      const m = String(e?.message || e);
      return `REVERT`;
    });
    console.log(`  ${i}->${j}: get_dy=${dy} | eth_call swap=${typeof raw === "string" && raw.startsWith("0x") && raw.length > 2 ? "OK" : raw}`);
  }
}
