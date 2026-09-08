// Real on-chain backtest of the swap path: same contract, same call shape
// the frontend sends. Uses the pool-owner key from local .env (testnet).
import { ethers } from "ethers";
import { config } from "dotenv";

config();

const RPCS = ["https://arc-testnet.drpc.org", "https://rpc.testnet.arc.network"];
const POOL = "0xDC3FaDc97013eee5Da21e19c1108B1fa1E608560";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const POOL_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)",
  "function getBalances() view returns (uint256[])",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];

const key = (process.env.MY_PK || "").trim();
if (!key) throw new Error("MY_PK missing from .env");
const wallet = new ethers.Wallet(key);

function failoverProvider() {
  // Mirror of the app's ArcFailoverProvider: per-request failover.
  const children = RPCS.map(
    (u) => new ethers.JsonRpcProvider(u, undefined, { batchMaxCount: 1, staticNetwork: true })
  );
  let active = 0;
  class Failover extends ethers.JsonRpcProvider {
    async send(method, params) {
      const order = RPCS.map((_, i) => (active + i) % RPCS.length);
      let lastErr = null;
      for (const idx of order) {
        try {
          const r =
            idx === 0
              ? await super.send(method, params)
              : await children[idx].send(method, params);
          active = idx;
          return r;
        } catch (e) {
          lastErr = e;
          if (!/rate limit|429|-3200|timeout|timed out|fetch|network/i.test(String(e?.message || e))) throw e;
        }
      }
      throw lastErr;
    }
  }
  return new Failover(RPCS[0], undefined, { batchMaxCount: 1, staticNetwork: true });
}

const provider = failoverProvider();
const signer = wallet.connect(provider);
const pool = new ethers.Contract(POOL, POOL_ABI, signer);
const eurc = new ethers.Contract(EURC, ERC20_ABI, provider);

const DX = 1_000_000n; // 1 EURC
const [balBefore, allow] = await Promise.all([
  eurc.balanceOf(wallet.address),
  eurc.allowance(wallet.address, POOL),
]);
console.log(`EURC balance: ${ethers.formatUnits(balBefore, 6)} | allowance: ${ethers.formatUnits(allow, 6)}`);

// 1. Quote (what the app's get_dy call does)
const dy = await pool.get_dy(1, 0, DX);
console.log(`Quote: 1 EURC -> ${ethers.formatUnits(dy, 6)} USDC`);
if (dy === 0n) throw new Error("get_dy returned 0");

// 2. Gas estimate with from override (what the app's simulation does)
const gas = await pool.swap.estimateGas(1, 0, DX, { from: wallet.address });
console.log(`Gas estimate (simulation): ${gas}`);
const gasLimit = (gas * 13n) / 10n;

// 3. Real swap — identical to buildSwapCall("swap(uint256,uint256,uint256)")
console.log("Sending swap tx...");
const tx = await pool.swap(1, 0, DX, { gasLimit });
console.log(`tx: https://testnet.arcscan.app/tx/${tx.hash}`);
const receipt = await tx.wait();
console.log(`status: ${receipt.status === 1 ? "SUCCESS ✅" : "FAILED ❌"} | gas used: ${receipt.gasUsed}`);

// 4. Verify outcome
const usdcBal = await provider.getBalance(wallet.address);
const [b0, b1] = await pool.getBalances();
console.log(`Native USDC after: ${ethers.formatEther(usdcBal)}`);
console.log(`Pool balances after: USDC=${ethers.formatUnits(b0, 6)} EURC=${ethers.formatUnits(b1, 6)}`);
console.log(receipt.status === 1 ? "\nBACKTEST PASSED: swap works end-to-end." : "\nBACKTEST FAILED");
