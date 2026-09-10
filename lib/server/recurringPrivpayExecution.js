import { ethers } from "ethers";
import {
  computePrivpayNoteLeafBytes,
  computePrivpayNullifierHashBytes,
  PRIVPAY_CIRCUIT_LEVELS,
} from "../../src/utils/privpayWitness.js";
import { extractPoolRootFromDepositReceipt } from "../../src/utils/privacyPoolDeposit.js";
import { assertRelayPoolAllowed } from "./privpayRelayCore.js";
import { getHealthyArcProvider, withArcRpc } from "./arcRpc.js";

const POOL_ABI = [
  "function depositFor(address from, bytes32 commitment, uint256 amount) external",
  "function token() view returns (address)",
];
const RECURRING_AUTOMATION_ABI = [
  "function executePoolDeposit(bytes32 authId, bytes32 commitment, uint256 amount) external",
  "function authorizations(bytes32) view returns (address payer, address executor, address token, address pool, uint128 maxAmountPerExecution, uint128 maxAmountPerPeriod, uint128 spentInPeriod, uint64 periodSeconds, uint64 periodWindowStart, bool active)",
];

const PERIOD_LIMIT_EXCEEDED_SELECTOR = "0xcd539000"; // PeriodLimitExceeded()

/**
 * Typed reasons autopay must PAUSE (not fail) — payer-side shortfalls the
 * server relayer cannot fix itself. Run handlers catch these, mark the
 * schedule/employee paused, and re-probe on later runs so autopay resumes
 * automatically once the wallet can pay again.
 */
export const AUTOPAY_PAUSE_INSUFFICIENT_FUNDS = "AUTOPAY_PAUSED_INSUFFICIENT_FUNDS";
export const AUTOPAY_PAUSE_NEEDS_APPROVAL = "AUTOPAY_PAUSED_NEEDS_APPROVAL";

export function isAutopayPauseError(err) {
  return (
    err?.code === AUTOPAY_PAUSE_INSUFFICIENT_FUNDS ||
    err?.code === AUTOPAY_PAUSE_NEEDS_APPROVAL
  );
}

function autopayPauseError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const ERC20_MIN = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
];

const TOKEN_ADDRESS_BY_SYMBOL = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
};

function symbolForTokenAddress(tokenAddress) {
  const target = String(tokenAddress || "").toLowerCase();
  for (const [symbol, addr] of Object.entries(TOKEN_ADDRESS_BY_SYMBOL)) {
    if (addr.toLowerCase() === target) return symbol;
  }
  return "token";
}

/** Treasury usage-fee config shared by the fee pull + readiness probe; null when disabled. */
function privpayUsageFeeInfo() {
  const treasuryRaw = String(
    process.env.PRIVPAY_TREASURY_ADDRESS ||
      process.env.VITE_PRIVPAY_TREASURY_ADDRESS ||
      process.env.ARCPAY_TREASURY_ADDRESS ||
      process.env.VITE_ARCPAY_TREASURY_ADDRESS ||
      ""
  ).trim();
  if (!treasuryRaw.startsWith("0x")) return null;
  const usdcAddr = ethers.getAddress(
    String(
      process.env.PRIVPAY_USDC_ADDRESS ||
        process.env.VITE_PRIVPAY_USDC_ADDRESS ||
        process.env.ARCPAY_USDC_ADDRESS ||
        process.env.VITE_ARCPAY_USDC_ADDRESS ||
        "0x3600000000000000000000000000000000000000"
    ).trim()
  );
  const feeStr = String(
    process.env.PRIVPAY_USAGE_FEE_USDC || process.env.ARCPAY_USAGE_FEE_USDC || "0.05"
  ).trim();
  return {
    treasury: ethers.getAddress(treasuryRaw),
    usdcAddr,
    feeStr,
    feeUnits: ethers.parseUnits(feeStr, 6),
  };
}

function parseArcAmountOrDefault(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return ethers.parseEther(fallback);
  try {
    return ethers.parseEther(raw);
  } catch {
    return ethers.parseEther(fallback);
  }
}

/**
 * Coerce to bigint. Avoid `x * 13n` style expressions in this file:
 * Vercel `@vercel/nft` static-eval can fold `x` to a number/null and crash the
 * deploy with "Cannot mix BigInt and other types".
 */
function asWei(value) {
  if (typeof value === "bigint") return value;
  if (value == null || value === "") return 0n;
  return BigInt(value);
}

/** Multiply then divide using assignment form (NFT-safe). */
function scaleWei(value, numer, denom) {
  let x = asWei(value);
  x *= asWei(numer);
  x /= asWei(denom);
  return x;
}

function parseSponsorPrivateKeys() {
  const seen = new Set();
  const keys = [];
  for (const envKey of [
    "MY_PK",
    "RECURRING_RELAYER_GAS_SPONSOR_PRIVATE_KEY",
    "ARC_DEPLOYER_PRIVATE_KEY",
  ]) {
    const k = String(process.env[envKey] || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) continue;
    const addr = new ethers.Wallet(k).address.toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);
    keys.push(k);
  }
  return keys;
}

function formatNativeGasUsdc(wei) {
  const raw = typeof wei === "bigint" ? wei : BigInt(String(wei || 0));
  const n = Number(ethers.formatEther(raw));
  const rounded = n >= 0.01 ? n.toFixed(4) : n.toFixed(6);
  return `${rounded} USDC`;
}

function userFacingGasError(message) {
  const msg = String(message || "");
  if (/gas sponsor|intrinsic transaction cost|insufficient funds|out of native|below gas minimum|needs .* gas/i.test(msg)) {
    return "Autopay is topping up relayer gas and will retry automatically.";
  }
  if (/Toggle Recurring|Fund autopay|prefund from your wallet/i.test(msg)) {
    return msg;
  }
  return msg;
}

/**
 * Nonce races on the shared relayer key: ethers v6 surfaces these as
 * NONCE_EXPIRED / "nonce has already been used" / "nonce too low" (often
 * wrapped in err.info.error). Never let these hard-fail a due bill —
 * sendRelayerContractTx re-reads the pending nonce and retries.
 */
function isNonceConflictError(err) {
  if (err?.code === "NONCE_EXPIRED" || err?.info?.error?.code === "NONCE_EXPIRED") {
    return true;
  }
  const msg = String(
    err?.shortMessage || err?.message || err?.info?.error?.message || err || ""
  );
  return /nonce has already been used|nonce too low|NONCE_EXPIRED/i.test(msg);
}

function isPeriodLimitExceededError(err) {
  const data = String(
    err?.data || err?.info?.error?.data || err?.error?.data || err?.message || err || ""
  );
  return (
    data.includes(PERIOD_LIMIT_EXCEEDED_SELECTOR) ||
    /PeriodLimitExceeded/i.test(data)
  );
}

function effectiveSpentInPeriod(auth) {
  const nowTs = Math.floor(Date.now() / 1000);
  const windowStart = Number(auth.periodWindowStart || 0);
  const periodSecs = Number(auth.periodSeconds || 0);
  if (periodSecs > 0 && nowTs >= windowStart + periodSecs) return 0n;
  return BigInt(auth.spentInPeriod || 0);
}

function userFacingExecutionError(err) {
  const msg = String(err?.message || err?.shortMessage || err || "");
  if (isNonceConflictError(err) || /nonce/i.test(msg)) {
    return "Autopay hit a temporary network queue conflict and will retry automatically.";
  }
  return userFacingGasError(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Global lock for the shared PRIVPAY relayer key.
 * Multiple due bills used to run in parallel and collide on the same nonce
 * (nonce too low / NONCE_EXPIRED) — serialize every fee + deposit send.
 */
const relayerTxGate =
  globalThis.__swaparcRelayerTxGate ||
  (globalThis.__swaparcRelayerTxGate = { chain: Promise.resolve() });

export async function withRelayerTxLock(fn) {
  const run = relayerTxGate.chain.catch(() => {}).then(() => fn());
  // Keep the chain alive even if this run fails.
  relayerTxGate.chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Send a relayer tx with a fresh pending nonce; retry briefly on nonce races. */
async function sendRelayerContractTx(relayerWallet, sendFn, baseOverrides = {}) {
  const from = await relayerWallet.getAddress();
  const provider = relayerWallet.provider;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const nonce = await provider.getTransactionCount(from, "pending");
      const tx = await sendFn({ ...baseOverrides, nonce });
      return tx;
    } catch (err) {
      lastErr = err;
      if (!isNonceConflictError(err)) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(userFacingExecutionError(lastErr));
}

/** Best-effort treasury top-up before autopay runs (uses MY_PK / sponsor env on server). */
export async function maintainRecurringRelayerGas(provider, relayerAddress) {
  const targetWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TARGET_MIN_ARC,
    "0.25"
  );
  const topUpWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_ARC,
    "0.15"
  );
  const marginWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_MARGIN_ARC,
    "0.02"
  );
  const sponsorReserveWei = parseArcAmountOrDefault(
    process.env.RECURRING_SPONSOR_RESERVE_ARC,
    "0.001"
  );
  const current = await provider.getBalance(relayerAddress);
  if (current >= targetWei) {
    return { ok: true, skipped: true, balanceWei: current.toString() };
  }

  let shortfall = targetWei;
  shortfall -= current;
  shortfall += marginWei;
  const sendWei = shortfall > topUpWei ? shortfall : topUpWei;

  for (const sponsorKey of parseSponsorPrivateKeys()) {
    const sponsor = new ethers.Wallet(sponsorKey, provider);
    const sponsorAddress = await sponsor.getAddress();
    if (sponsorAddress.toLowerCase() === String(relayerAddress).toLowerCase()) {
      continue;
    }
    const sponsorBalance = await provider.getBalance(sponsorAddress);
    let affordable = 0n;
    if (sponsorBalance > sponsorReserveWei) {
      affordable = sponsorBalance;
      affordable -= sponsorReserveWei;
    }
    if (affordable <= 0n) continue;
    const actualSend = affordable >= sendWei ? sendWei : affordable;
    if (actualSend <= 0n) continue;
    const topUpTx = await sponsor.sendTransaction({ to: relayerAddress, value: actualSend });
    await topUpTx.wait(1);
    const after = await provider.getBalance(relayerAddress);
    return {
      ok: after >= targetWei || after > current,
      funded: true,
      topUpTxHash: topUpTx.hash,
      balanceWei: after.toString(),
      sponsorAddress,
    };
  }
  return { ok: false, balanceWei: current.toString() };
}

/**
 * Ensure the relayer holds enough native USDC (Arc gas) to cover the whole run.
 * `requiredWei` is a per-execution estimate (fee pull + pool deposit) computed by
 * the caller. Operator `MY_PK` (or RECURRING_RELAYER_GAS_SPONSOR_PRIVATE_KEY) tops
 * up automatically — payers are not asked to fund gas.
 */
async function ensureRelayerGasBudget(provider, relayerWallet, requiredWei) {
  const relayerAddress = await relayerWallet.getAddress();
  const currentBalance = await provider.getBalance(relayerAddress);

  const marginWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_MARGIN_ARC,
    "0.02"
  );
  const sponsorReserveWei = parseArcAmountOrDefault(
    process.env.RECURRING_SPONSOR_RESERVE_ARC,
    "0.001"
  );
  /** Hard floor: one Poseidon-Merkle deposit at ~21 gwei is ~0.05 native USDC. */
  const minFloorWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_MIN_EXECUTION_ARC,
    "0.08"
  );
  const healthyTargetWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TARGET_MIN_ARC,
    "0.25"
  );
  const topUpWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_ARC,
    "0.15"
  );

  const req = asWei(requiredWei);
  const needWei = req > minFloorWei ? req : minFloorWei;
  let targetWei = needWei;
  targetWei += marginWei;
  if (targetWei < healthyTargetWei) targetWei = healthyTargetWei;

  if (currentBalance >= targetWei) {
    return { funded: false, relayerBalanceWei: currentBalance.toString() };
  }

  const shortfall = targetWei - currentBalance;
  const desiredSend = shortfall > topUpWei ? shortfall : topUpWei;

  const sponsorKeys = parseSponsorPrivateKeys();
  if (!sponsorKeys.length) {
    throw new Error(
      userFacingGasError(
        `Recurring relayer needs ${formatNativeGasUsdc(targetWei)} gas (has ${formatNativeGasUsdc(currentBalance)}). Configure MY_PK to auto-sponsor relayer gas.`
      )
    );
  }

  let lastError = null;
  for (const sponsorKey of sponsorKeys) {
    const sponsor = new ethers.Wallet(sponsorKey, provider);
    const sponsorAddress = await sponsor.getAddress();
    if (sponsorAddress.toLowerCase() === relayerAddress.toLowerCase()) {
      lastError = new Error(
        "Recurring gas sponsor key must be different from relayer key to auto-top-up relayer gas."
      );
      continue;
    }

    const sponsorBalance = await provider.getBalance(sponsorAddress);
    let affordable = 0n;
    if (sponsorBalance > sponsorReserveWei) {
      affordable = sponsorBalance;
      affordable -= sponsorReserveWei;
    }
    if (affordable <= 0n) {
      lastError = new Error(
        userFacingGasError("Autopay gas sponsor wallet is empty (native USDC).")
      );
      continue;
    }

    const actualSend = affordable >= desiredSend ? desiredSend : affordable;

    try {
      const topUpTx = await sponsor.sendTransaction({
        to: relayerAddress,
        value: actualSend,
      });
      await topUpTx.wait(1);
      const newBalance = await provider.getBalance(relayerAddress);
      if (newBalance >= needWei) {
        return {
          funded: true,
          topUpTxHash: topUpTx.hash,
          relayerBalanceWei: newBalance.toString(),
          sponsorAddress,
          partialTopUp: actualSend < shortfall,
        };
      }
      lastError = new Error(
        userFacingGasError(
          `Relayer still below gas minimum after top-up (has ${formatNativeGasUsdc(newBalance)}, needs ${formatNativeGasUsdc(needWei)}).`
        )
      );
    } catch (err) {
      lastError = new Error(userFacingGasError(err?.message || String(err)));
    }
  }

  throw (
    lastError ||
    new Error(userFacingGasError("Autopay is topping up relayer gas and will retry automatically."))
  );
}

/** Proactive MY_PK top-up used by /run before due bills execute. */
export async function maintainRecurringRelayerGasBestEffort() {
  try {
    const relayerKey = String(process.env.PRIVACY_POOL_RELAYER_PRIVATE_KEY || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
      return { ok: false, reason: "no-relayer-key" };
    }
    const provider = await getHealthyArcProvider({ purpose: "relayer-gas-maintain" });
    const relayer = new ethers.Wallet(relayerKey, provider);
    return maintainRecurringRelayerGas(provider, await relayer.getAddress());
  } catch (err) {
    console.warn(
      "[recurring] maintainRelayerGasBestEffort:",
      err?.message || String(err)
    );
    return { ok: false, reason: err?.message || String(err) };
  }
}

/** Best-effort gas estimate; returns null when the node cannot simulate the call. */
async function estimateGasBestEffort(estimateFn) {
  try {
    const g = await estimateFn();
    return g == null ? null : BigInt(g);
  } catch {
    return null;
  }
}

/** Resolve a sane, slightly-bumped gas price for relayer transactions on Arc. */
async function resolveGasPrice(provider) {
  try {
    const feeData = await provider.getFeeData();
    const base = feeData?.gasPrice ?? feeData?.maxFeePerGas ?? null;
    if (base != null) {
      const b = asWei(base);
      if (b > 0n) return scaleWei(b, 11n, 10n);
    }
  } catch {
    // fall through to default
  }
  return 23_100_000_000n; // 21 gwei + 10%
}

function resolvePoolAddressForToken(tokenAddressInput) {
  const tokenAddress = ethers.getAddress(String(tokenAddressInput || "").trim());
  const usdcToken = ethers.getAddress(TOKEN_ADDRESS_BY_SYMBOL.USDC);
  const eurcToken = ethers.getAddress(TOKEN_ADDRESS_BY_SYMBOL.EURC);
  const swprcToken = ethers.getAddress(TOKEN_ADDRESS_BY_SYMBOL.SWPRC);

  if (tokenAddress === usdcToken) {
    return String(
      process.env.PRIVACY_POOL_ADDRESS_USDC ||
        process.env.VITE_PRIVACY_POOL_ADDRESS_USDC ||
        process.env.PRIVACY_POOL_ADDRESS ||
        process.env.VITE_PRIVACY_POOL_ADDRESS ||
        ""
    ).trim();
  }
  if (tokenAddress === eurcToken) {
    return String(
      process.env.PRIVACY_POOL_ADDRESS_EURC || process.env.VITE_PRIVACY_POOL_ADDRESS_EURC || ""
    ).trim();
  }
  if (tokenAddress === swprcToken) {
    return String(
      process.env.PRIVACY_POOL_ADDRESS_SWPRC || process.env.VITE_PRIVACY_POOL_ADDRESS_SWPRC || ""
    ).trim();
  }
  return "";
}

function encodePoolClaimPayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function finalizeZkPoolClaimExport({
  receipt,
  poolAddress,
  commitment,
  recipient,
  tokenAddress,
  amountHuman,
  decimals,
  amountWei,
  secret,
  nullifier,
}) {
  const base = {
    v: 3,
    scheme: "zk-claim",
    poolAddress,
    tokenAddress,
    recipient,
    amount: String(amountHuman),
    amountWei: String(amountWei),
    decimals: Number(decimals) || 18,
    commitment,
    secret,
    nullifier,
    merkleHeight: PRIVPAY_CIRCUIT_LEVELS,
    root: null,
    leafIndex: null,
    hint: "SENSITIVE: preimage included. Recipient: PRIVPAY → Bills → Payments Claim → paste claim code, then claim.",
  };
  if (!receipt) {
    return { poolClaimPayload: base, poolClaimCode: encodePoolClaimPayload(base) };
  }
  const pos = extractPoolRootFromDepositReceipt(receipt, poolAddress, commitment);
  if (!pos) {
    return { poolClaimPayload: base, poolClaimCode: encodePoolClaimPayload(base) };
  }
  const full = { ...base, root: pos.root, leafIndex: pos.leafIndex };
  return { poolClaimPayload: full, poolClaimCode: encodePoolClaimPayload(full) };
}

/**
 * Pull PRIVPAY usage fee (USDC) from payer via relay; requires `usdc.approve(relay, fee+)` once.
 * Shortfalls throw typed autopay-pause errors so the caller pauses instead of burning retries.
 */
async function chargePrivpayUsageFeeRelay(relayerWallet, payerAddress, gasPrice = null) {
  const fee = privpayUsageFeeInfo();
  if (!fee) return;

  const { treasury, usdcAddr, feeStr, feeUnits } = fee;
  const usdc = new ethers.Contract(usdcAddr, ERC20_MIN, relayerWallet);
  const relay = await relayerWallet.getAddress();
  const allowance = await readAllowanceBestEffort(usdcAddr, payerAddress, relay);
  if (allowance == null || allowance < feeUnits) {
    throw autopayPauseError(
      AUTOPAY_PAUSE_NEEDS_APPROVAL,
      `Autopay paused — re-approve USDC for the relayer so the ${feeStr} usage fee can be sent (one signature in the app resumes it).`
    );
  }
  const feeBalance = await readTokenBalanceBestEffort(usdcAddr, payerAddress);
  if (feeBalance != null && feeBalance < feeUnits) {
    throw autopayPauseError(
      AUTOPAY_PAUSE_INSUFFICIENT_FUNDS,
      `Autopay paused — wallet needs ${feeStr} USDC for the usage fee. It resumes automatically once funded.`
    );
  }
  const overrides = gasPrice ? { gasPrice } : {};
  const tx = await sendRelayerContractTx(
    relayerWallet,
    (o) => usdc.transferFrom(payerAddress, treasury, feeUnits, o),
    overrides
  );
  await tx.wait(1);
}

async function readAllowanceBestEffort(tokenAddressOrContract, owner, spender) {
  const tokenAddr =
    typeof tokenAddressOrContract === "string"
      ? tokenAddressOrContract
      : tokenAddressOrContract?.target || tokenAddressOrContract?.address;
  if (!tokenAddr) return null;
  try {
    const v = await withArcRpc(
      (p) =>
        new ethers.Contract(tokenAddr, ERC20_MIN, p).allowance(owner, spender),
      "recurring-allowance"
    );
    return BigInt(v);
  } catch {
    // Some ARC testnet token wrappers can fail allowance() eth_call; keep flow resilient.
    return null;
  }
}

async function readTokenBalanceBestEffort(tokenAddress, owner) {
  const tokenAddr = String(tokenAddress || "").trim();
  if (!tokenAddr.startsWith("0x")) return null;
  try {
    const v = await withArcRpc(
      (p) => new ethers.Contract(tokenAddr, ERC20_MIN, p).balanceOf(owner),
      "recurring-balance"
    );
    return BigInt(v);
  } catch {
    // Best-effort like the allowance read; the tx itself surfaces hard failures.
    return null;
  }
}

/**
 * Server-side privacy pool deposit for recurring bills (cron / API). Payer must approve the pool for the bill token; payer must approve USDC to relay for usage fee when treasury env is set.
 */
export async function executeRecurringPrivpayDeposit(schedule) {
  const recipientRaw = String(
    schedule.recipientWallet || schedule.metadata?.recipientWallet || ""
  ).trim();
  if (!recipientRaw.startsWith("0x")) {
    throw new Error(
      "Server recurring needs a recipient wallet on the bill (privacy pool rail). Stealth-only bills still run from the app while it is open."
    );
  }

  const poolAddress = resolvePoolAddressForToken(schedule.tokenAddress);
  if (!poolAddress.startsWith("0x")) {
    throw new Error(
      `Server missing privacy pool mapping for token ${schedule.tokenAddress}. Set PRIVACY_POOL_ADDRESS_USDC/EURC/SWPRC.`
    );
  }
  assertRelayPoolAllowed(poolAddress);

  const key = String(process.env.PRIVACY_POOL_RELAYER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "Set PRIVACY_POOL_RELAYER_PRIVATE_KEY to run recurring pool deposits (gas + depositFor sender)."
    );
  }

  // Public RPC first (short timeout); free dRPC next; Alchemy only if those fail.
  // Sticky cooldown skips public for a few minutes after rate-limit so autopay keeps working.
  let provider;
  try {
    provider = await getHealthyArcProvider("recurring-deposit");
  } catch (err) {
    throw new Error(
      /request limit|rate limit|-32011|coalesce|timed out/i.test(String(err?.message || err))
        ? "Network busy — retrying on backup RPC…"
        : String(err?.message || err)
    );
  }
  const relayer = new ethers.Wallet(key, provider);

  const recipient = ethers.getAddress(recipientRaw);
  const payer = ethers.getAddress(String(schedule.payerAddress || "").trim());
  const tokenAddress = ethers.getAddress(String(schedule.tokenAddress || "").trim());

  const tokenReader = new ethers.Contract(tokenAddress, ERC20_MIN, provider);
  const decimals = Number(await tokenReader.decimals().catch(() => 6));
  const amountUnits = ethers.parseUnits(String(schedule.amount), decimals);

  const poolRead = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const poolToken = await poolRead.token();
  if (ethers.getAddress(poolToken) !== tokenAddress) {
    throw new Error(`Pool expects token ${poolToken}; schedule uses ${tokenAddress}`);
  }

  // Payer-side shortfall check BEFORE any relayer gas spend: pause (typed) when
  // the wallet cannot cover this payment — plus the USDC usage fee when the
  // bill token IS USDC — so autopay resumes automatically once funded.
  const feeInfo = privpayUsageFeeInfo();
  let requiredPayerUnits = amountUnits;
  if (feeInfo && tokenAddress === feeInfo.usdcAddr) {
    requiredPayerUnits += feeInfo.feeUnits;
  }
  const payerBalance = await readTokenBalanceBestEffort(tokenAddress, payer);
  if (payerBalance != null && payerBalance < requiredPayerUnits) {
    throw autopayPauseError(
      AUTOPAY_PAUSE_INSUFFICIENT_FUNDS,
      `Autopay paused — wallet needs ${ethers.formatUnits(requiredPayerUnits, decimals)} ${symbolForTokenAddress(tokenAddress)} to keep paying. It resumes automatically once funded.`
    );
  }

  const secret = ethers.hexlify(ethers.randomBytes(32));
  const nullifier = ethers.hexlify(ethers.randomBytes(32));
  const poolNullifierHash = ethers.hexlify(
    await computePrivpayNullifierHashBytes(secret, nullifier)
  );
  const commitment = ethers.hexlify(
    await computePrivpayNoteLeafBytes(secret, nullifier, amountUnits, recipient)
  );

  const poolWrite = new ethers.Contract(poolAddress, POOL_ABI, relayer);
  const recurringAutomationAddress = String(
    process.env.RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
      process.env.VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
      ""
  ).trim();
  const authId = String(schedule.metadata?.onchainAuthorizationId || ethers.id(String(schedule.id || "")));
  const strict =
    String(process.env.RECURRING_AUTOMATION_STRICT || "").toLowerCase() === "true";

  // Decide the deposit path + pre-estimate gas BEFORE spending anything, so the
  // relayer can be funded to cover the *actual* transaction cost (previously a
  // fixed 0.04 floor left EURC/SWPRC deposits failing on intrinsic gas cost).
  const useAutomation = recurringAutomationAddress.startsWith("0x");
  let sendDeposit;
  let allowAutomationFallback = false;
  let depositGasEstimate = null;

  if (useAutomation) {
    const recurringAutomationChecksum = ethers.getAddress(recurringAutomationAddress);
    const authAllowance = await readAllowanceBestEffort(
      tokenReader,
      payer,
      recurringAutomationChecksum
    );
    if (authAllowance != null && authAllowance < amountUnits) {
      throw autopayPauseError(
        AUTOPAY_PAUSE_NEEDS_APPROVAL,
        `Autopay paused — ${symbolForTokenAddress(tokenAddress)} allowance for RecurringPoolAutomation is too low. Open the app once to re-approve (one signature) and it resumes.`
      );
    }
    const recurringAutomation = new ethers.Contract(
      recurringAutomationChecksum,
      RECURRING_AUTOMATION_ABI,
      relayer
    );

    // If this period's cap is already spent, a prior attempt likely succeeded on-chain
    // while the server marked retry (RPC flake). Advance as settled — do NOT charge fee again.
    try {
      const auth = await recurringAutomation.authorizations(authId);
      if (auth?.active) {
        const spent = effectiveSpentInPeriod(auth);
        const maxPeriod = asWei(auth.maxAmountPerPeriod || 0);
        let spentNext = asWei(spent);
        spentNext += asWei(amountUnits);
        if (maxPeriod > 0n && spentNext > maxPeriod) {
          return {
            paymentRail: "privacyPool",
            txHash: null,
            alreadySettledThisPeriod: true,
            onchainAuthorizationId: authId,
            poolAddress,
            poolNullifierHash: null,
            poolCommitment: null,
            poolRecipient: recipient,
            poolClaimCode: null,
            poolClaimPayload: null,
            blockNumber: null,
            scheduleId: schedule.id,
            billName: schedule.metadata?.billName || null,
            relayerGasTopUp: null,
            note: "Already settled for this billing period on-chain.",
          };
        }
      }
    } catch {
      // If auth read fails, continue and let estimateGas / send surface the real error.
    }

    allowAutomationFallback = !strict;
    depositGasEstimate = await estimateGasBestEffort(() =>
      recurringAutomation.executePoolDeposit.estimateGas(authId, commitment, amountUnits)
    );
    sendDeposit = (overrides) =>
      recurringAutomation.executePoolDeposit(authId, commitment, amountUnits, overrides);
  } else {
    const poolAllowance = await readAllowanceBestEffort(tokenReader, payer, poolAddress);
    if (poolAllowance != null && poolAllowance < amountUnits) {
      throw autopayPauseError(
        AUTOPAY_PAUSE_NEEDS_APPROVAL,
        `Autopay paused — ${symbolForTokenAddress(tokenAddress)} allowance for the privacy pool is too low. Open the app once to re-approve (one signature) and it resumes.`
      );
    }
    depositGasEstimate = await estimateGasBestEffort(() =>
      poolWrite.depositFor.estimateGas(payer, commitment, amountUnits)
    );
    sendDeposit = (overrides) => poolWrite.depositFor(payer, commitment, amountUnits, overrides);
  }

  const gasPrice = await resolveGasPrice(provider);
  // Fallback ~2.4M gas covers a Poseidon-Merkle deposit + transferFrom/approvals
  // when the node cannot simulate (e.g. allowance not yet visible).
  // Assignment-style bigint math — see asWei()/scaleWei() note (Vercel NFT).
  let depGasForBudget = depositGasEstimate == null ? 2_400_000n : asWei(depositGasEstimate);
  let feeGasForBudget = 120_000n; // relayer-sent transferFrom usage-fee pull
  let requiredWei = depGasForBudget;
  requiredWei += feeGasForBudget;
  requiredWei *= asWei(gasPrice);
  requiredWei = scaleWei(requiredWei, 13n, 10n);

  const gasTopUp = await ensureRelayerGasBudget(provider, relayer, requiredWei);

  const depositOverrides = { gasPrice };
  if (depositGasEstimate != null) {
    depositOverrides.gasLimit = scaleWei(depositGasEstimate, 13n, 10n);
  }

  const isGasShortfall = (err) =>
    /insufficient funds|intrinsic transaction cost|gas \* price/i.test(
      String(err?.message || err || "")
    );

  // Fee pull + deposit must be sequential under one global lock so parallel
  // due bills (Water/Internet/Electricity) cannot collide on the relayer nonce.
  const lockResult = await withRelayerTxLock(async () => {
    await chargePrivpayUsageFeeRelay(relayer, payer, gasPrice);

    const trySend = async () => {
      try {
        return await sendRelayerContractTx(relayer, sendDeposit, depositOverrides);
      } catch (err) {
        if (isPeriodLimitExceededError(err)) {
          const settledErr = new Error("PERIOD_ALREADY_SETTLED");
          settledErr.code = "PERIOD_ALREADY_SETTLED";
          throw settledErr;
        }
        if (allowAutomationFallback && !isGasShortfall(err) && !isNonceConflictError(err)) {
          return sendRelayerContractTx(
            relayer,
            (o) => poolWrite.depositFor(payer, commitment, amountUnits, o),
            depositOverrides
          );
        }
        throw err;
      }
    };

    let sent;
    try {
      sent = await trySend();
    } catch (err) {
      if (err?.code === "PERIOD_ALREADY_SETTLED" || isPeriodLimitExceededError(err)) {
        return { tx: null, receipt: null, alreadySettledThisPeriod: true };
      }
      if (!isGasShortfall(err)) {
        throw new Error(userFacingExecutionError(err));
      }
      await ensureRelayerGasBudget(
        provider,
        relayer,
        scaleWei(requiredWei, 3n, 2n)
      ).catch(() => {});
      try {
        sent = await trySend();
      } catch (err2) {
        if (err2?.code === "PERIOD_ALREADY_SETTLED" || isPeriodLimitExceededError(err2)) {
          return { tx: null, receipt: null, alreadySettledThisPeriod: true };
        }
        throw new Error(userFacingExecutionError(err2));
      }
    }
    const mined = await sent.wait();
    return { tx: sent, receipt: mined };
  });

  if (lockResult?.alreadySettledThisPeriod) {
    return {
      paymentRail: "privacyPool",
      txHash: null,
      alreadySettledThisPeriod: true,
      onchainAuthorizationId: authId,
      poolAddress,
      poolNullifierHash: null,
      poolCommitment: null,
      poolRecipient: recipient,
      poolClaimCode: null,
      poolClaimPayload: null,
      blockNumber: null,
      scheduleId: schedule.id,
      billName: schedule.metadata?.billName || null,
      relayerGasTopUp: gasTopUp?.funded
        ? {
            txHash: gasTopUp.topUpTxHash || null,
            relayerBalanceWei: gasTopUp.relayerBalanceWei || null,
            sponsorAddress: gasTopUp.sponsorAddress || null,
          }
        : null,
      note: "Already settled for this billing period on-chain.",
    };
  }
  if (!lockResult?.tx) {
    throw new Error("Autopay deposit did not return a transaction.");
  }

  const tx = lockResult.tx;
  const receipt = lockResult.receipt;

  const fin = finalizeZkPoolClaimExport({
    receipt,
    poolAddress,
    commitment,
    recipient,
    tokenAddress,
    amountHuman: schedule.amount,
    decimals,
    amountWei: amountUnits,
    secret,
    nullifier,
  });

  return {
    paymentRail: "privacyPool",
    txHash: tx.hash,
    onchainAuthorizationId: authId,
    poolAddress,
    poolNullifierHash,
    poolCommitment: commitment,
    poolRecipient: recipient,
    poolClaimCode: fin.poolClaimCode,
    poolClaimPayload: fin.poolClaimPayload || null,
    blockNumber: receipt?.blockNumber != null ? Number(receipt.blockNumber) : null,
    scheduleId: schedule.id,
    billName: schedule.metadata?.billName || null,
    relayerGasTopUp: gasTopUp?.funded
      ? {
          txHash: gasTopUp.topUpTxHash || null,
          relayerBalanceWei: gasTopUp.relayerBalanceWei || null,
          sponsorAddress: gasTopUp.sponsorAddress || null,
        }
      : null,
  };
}

export async function recurringScheduleExecutionHandler(schedule) {
  return executeRecurringPrivpayDeposit(schedule);
}

/**
 * Read-only check used by run handlers to test PAUSED schedules/employees for
 * recovery: can the payer cover the payment (+ fee) and are the allowances in
 * place? Reads go through the Arc RPC fallback chain; a failed read is treated
 * as "not ready yet" so the paused row is simply re-checked on the next run.
 */
export async function probeRecurringAutopayReadiness(schedule) {
  const payer = String(schedule?.payerAddress || "").trim();
  const tokenAddress = String(schedule?.tokenAddress || "").trim();
  if (!payer.startsWith("0x") || !tokenAddress.startsWith("0x")) {
    return { ready: false, reasonCode: null, reason: "invalid schedule", balanceUnits: null, allowanceUnits: null };
  }
  const payerAddr = ethers.getAddress(payer);
  const tokenAddr = ethers.getAddress(tokenAddress);

  let decimals = 6;
  try {
    decimals = Number(
      await withArcRpc(
        (p) => new ethers.Contract(tokenAddr, ERC20_MIN, p).decimals(),
        "autopay-readiness-decimals"
      )
    );
  } catch {
    // default 6
  }
  const amountUnits = ethers.parseUnits(String(schedule.amount), Number.isFinite(decimals) ? decimals : 6);

  const feeInfo = privpayUsageFeeInfo();
  let requiredUnits = amountUnits;
  if (feeInfo && tokenAddr === feeInfo.usdcAddr) {
    requiredUnits += feeInfo.feeUnits;
  }

  const balanceUnits = await readTokenBalanceBestEffort(tokenAddr, payerAddr);
  if (balanceUnits != null && balanceUnits < requiredUnits) {
    return {
      ready: false,
      reasonCode: AUTOPAY_PAUSE_INSUFFICIENT_FUNDS,
      reason: `Autopay paused — wallet needs ${ethers.formatUnits(requiredUnits, decimals)} ${symbolForTokenAddress(tokenAddr)} to keep paying. It resumes automatically once funded.`,
      balanceUnits: String(balanceUnits),
      allowanceUnits: null,
    };
  }

  // Same spender the deposit path pulls through: automation contract when
  // configured, otherwise the privacy pool itself.
  const automationAddress = String(
    process.env.RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
      process.env.VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS ||
      ""
  ).trim();
  const poolAddress = automationAddress.startsWith("0x")
    ? null
    : resolvePoolAddressForToken(tokenAddr);
  const spender = automationAddress.startsWith("0x")
    ? ethers.getAddress(automationAddress)
    : poolAddress && poolAddress.startsWith("0x")
      ? ethers.getAddress(poolAddress)
      : null;

  let allowanceUnits = null;
  if (spender) {
    allowanceUnits = await readAllowanceBestEffort(tokenAddr, payerAddr, spender);
    if (allowanceUnits != null && allowanceUnits < amountUnits) {
      return {
        ready: false,
        reasonCode: AUTOPAY_PAUSE_NEEDS_APPROVAL,
        reason: `Autopay paused — ${symbolForTokenAddress(tokenAddr)} allowance is too low. Open the app once to re-approve (one signature) and it resumes.`,
        balanceUnits: balanceUnits == null ? null : String(balanceUnits),
        allowanceUnits: String(allowanceUnits),
      };
    }
  }

  // USDC usage-fee allowance to the relayer (independent of the bill token).
  if (feeInfo) {
    const relayerKey = String(process.env.PRIVACY_POOL_RELAYER_PRIVATE_KEY || "").trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
      const relayerAddress = new ethers.Wallet(relayerKey).address;
      const feeAllowance = await readAllowanceBestEffort(feeInfo.usdcAddr, payerAddr, relayerAddress);
      if (feeAllowance != null && feeAllowance < feeInfo.feeUnits) {
        return {
          ready: false,
          reasonCode: AUTOPAY_PAUSE_NEEDS_APPROVAL,
          reason: `Autopay paused — re-approve USDC for the relayer so the ${feeInfo.feeStr} usage fee can be sent (one signature in the app resumes it).`,
          balanceUnits: balanceUnits == null ? null : String(balanceUnits),
          allowanceUnits: String(feeAllowance),
        };
      }
    }
  }

  return {
    ready: true,
    reasonCode: null,
    reason: null,
    balanceUnits: balanceUnits == null ? null : String(balanceUnits),
    allowanceUnits: allowanceUnits == null ? null : String(allowanceUnits),
  };
}
