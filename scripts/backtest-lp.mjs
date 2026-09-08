// Real on-chain backtest of the LP flow on the DEPLOYED pool contracts
// (same calls the frontend makes). Uses MY_PK from local .env (testnet).
import { ethers } from "ethers";
import { config } from "dotenv";

config();

const RPC = "https://arc-testnet.drpc.org";
const POOL = "0xd22e4fB80E21e8d2C91131eC2D6b0C000491934B"; // USDC/EURC LP pool
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const LP = "0x454f21b7738A446f79ea4ff00e71b9e8E9E6FEE9";

const POOL_ABI = [
  "function addLiquidity(uint256[] amounts)",
  "function removeLiquidity(uint256 lpAmount)",
  "function claimRewards()",
  "function getBalances() view returns (uint256[])",
  "function lpToken() view returns (address)",
  "function tokens(uint256) view returns (address)",
  "function balances(uint256) view returns (uint256)",
  "function liquidityOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function rewardRatePerSecond() view returns (uint256)",
  "function owner() view returns (address)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
const key = (process.env.MY_PK || "").trim();
const signer = new ethers.Wallet(key).connect(provider);
const pool = new ethers.Contract(POOL, POOL_ABI, signer);
const eurc = new ethers.Contract(EURC, ERC20_ABI, signer);
const lp = new ethers.Contract(LP, ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"], provider);

// 0. Deployed-contract introspection
console.log("=== DEPLOYED LP POOL STATE ===");
console.log("lpToken():", await pool.lpToken().catch(() => "n/a"));
console.log("tokens(0):", await pool.tokens(0).catch(() => "n/a"));
console.log("tokens(1):", await pool.tokens(1).catch(() => "n/a"));
console.log("owner():", await pool.owner().catch(() => "n/a"));
const bal = await pool.getBalances();
console.log("getBalances():", bal.map((b) => b.toString()).join(", "));
console.log("totalSupply (LP):", (await lp.totalSupply()).toString());
const ts = await pool.totalSupply().catch(() => null);
if (ts != null) console.log("pool.totalSupply():", ts.toString());
console.log("liquidityOf(MY_PK):", (await pool.liquidityOf(signer.address).catch(() => "?")).toString?.());

// 1. Approve EURC to the LP pool (if needed)
const AMOUNT = 2_000_000n; // 2 EURC
let allow = await eurc.allowance(signer.address, POOL);
if (allow < AMOUNT) {
  console.log("\nApproving EURC to LP pool...");
  const a = await eurc.approve(POOL, ethers.MaxUint256);
  await a.wait();
  console.log("Approved ✅", a.hash);
}

// 2. Simulate addLiquidity([0, 2e6]) — same shape the frontend sends
const amounts = [0n, AMOUNT];
try {
  const gas = await pool.addLiquidity.estimateGas(amounts, { from: signer.address });
  console.log(`\nSimulation addLiquidity([0, 2 EURC]): OK, gas=${gas}`);
} catch (e) {
  console.log(`\nSimulation addLiquidity FAILED: ${e.info?.error?.message || e.shortMessage || e.message}`);
  process.exit(1);
}

// 3. Real addLiquidity
const lpBefore = await lp.balanceOf(signer.address);
const tx = await pool.addLiquidity(amounts);
console.log("addLiquidity tx:", tx.hash);
const rc = await tx.wait();
console.log(`status: ${rc.status === 1 ? "SUCCESS ✅" : "FAILED ❌"} | gas: ${rc.gasUsed}`);
const lpAfter = await lp.balanceOf(signer.address);
console.log(`LP minted: ${ethers.formatUnits(lpAfter - lpBefore, 18)} (balances ${lpBefore} -> ${lpAfter})`);
console.log("Pool balances after:", (await pool.getBalances()).map((b) => b.toString()).join(", "));
