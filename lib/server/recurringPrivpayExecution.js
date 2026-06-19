import { ethers } from "ethers";
import {
  computePrivpayNoteLeafBytes,
  computePrivpayNullifierHashBytes,
  PRIVPAY_CIRCUIT_LEVELS,
} from "../../src/utils/privpayWitness.js";
import { extractPoolRootFromDepositReceipt } from "../../src/utils/privacyPoolDeposit.js";
import { assertRelayPoolAllowed } from "./privpayRelayCore.js";

const POOL_ABI = [
  "function depositFor(address from, bytes32 commitment, uint256 amount) external",
  "function token() view returns (address)",
];
const RECURRING_AUTOMATION_ABI = [
  "function executePoolDeposit(bytes32 authId, bytes32 commitment, uint256 amount) external",
];

const ERC20_MIN = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
];

const TOKEN_ADDRESS_BY_SYMBOL = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  SWPRC: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
};

function parseArcAmountOrDefault(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return ethers.parseEther(fallback);
  try {
    return ethers.parseEther(raw);
  } catch {
    return ethers.parseEther(fallback);
  }
}

function parseSponsorPrivateKeys() {
  const seen = new Set();
  const keys = [];
  for (const envKey of [
    "RECURRING_RELAYER_GAS_SPONSOR_PRIVATE_KEY",
    "MY_PK",
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

async function ensureRelayerGasBudget(provider, relayerWallet) {
  const relayerAddress = await relayerWallet.getAddress();
  const currentBalance = await provider.getBalance(relayerAddress);

  /** Must cover fee pull + pool deposit on Arc testnet (typical ~0.03–0.05 ARC). */
  const minExecutionWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_MIN_EXECUTION_ARC,
    "0.04"
  );
  const topUpArcWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_ARC,
    "0.05"
  );
  const marginWei = parseArcAmountOrDefault(
    process.env.RECURRING_RELAYER_TOPUP_MARGIN_ARC,
    "0.005"
  );
  const sponsorReserveWei = parseArcAmountOrDefault(
    process.env.RECURRING_SPONSOR_RESERVE_ARC,
    "0.001"
  );

  if (currentBalance >= minExecutionWei) {
    return { funded: false, relayerBalanceWei: currentBalance.toString() };
  }

  const shortfall = minExecutionWei - currentBalance;
  let sendWei = shortfall + marginWei;
  if (sendWei > topUpArcWei) sendWei = topUpArcWei;

  const sponsorKeys = parseSponsorPrivateKeys();
  if (!sponsorKeys.length) {
    throw new Error(
      `Recurring relayer needs ${ethers.formatEther(minExecutionWei)} ARC gas (has ${ethers.formatEther(currentBalance)}). Toggle Recurring off/on in the app to fund the relayer from your wallet.`
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
    const affordable =
      sponsorBalance > sponsorReserveWei ? sponsorBalance - sponsorReserveWei : 0n;
    if (affordable <= 0n) {
      lastError = new Error(
        `Recurring gas sponsor ${sponsorAddress.slice(0, 10)}… balance too low (${ethers.formatEther(sponsorBalance)} ARC).`
      );
      continue;
    }

    const actualSend = affordable >= sendWei ? sendWei : affordable;

    try {
      const topUpTx = await sponsor.sendTransaction({
        to: relayerAddress,
        value: actualSend,
      });
      await topUpTx.wait(1);
      const newBalance = await provider.getBalance(relayerAddress);
      if (newBalance >= minExecutionWei) {
        return {
          funded: true,
          topUpTxHash: topUpTx.hash,
          relayerBalanceWei: newBalance.toString(),
          sponsorAddress,
          partialTopUp: actualSend < sendWei,
        };
      }
      lastError = new Error(
        `Relayer still below gas minimum after top-up (${ethers.formatEther(newBalance)} ARC). Toggle Recurring off/on to prefund from your wallet.`
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw (
    lastError ||
    new Error(
      "Recurring relayer is out of ARC gas. Toggle Recurring off/on in Bills to send gas from your wallet."
    )
  );
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
 */
async function chargePrivpayUsageFeeRelay(relayerWallet, payerAddress) {
  const treasuryRaw = String(
    process.env.PRIVPAY_TREASURY_ADDRESS ||
      process.env.VITE_PRIVPAY_TREASURY_ADDRESS ||
      process.env.ARCPAY_TREASURY_ADDRESS ||
      process.env.VITE_ARCPAY_TREASURY_ADDRESS ||
      ""
  ).trim();
  if (!treasuryRaw.startsWith("0x")) return;

  const treasury = ethers.getAddress(treasuryRaw);
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
    process.env.PRIVPAY_USAGE_FEE_USDC || process.env.ARCPAY_USAGE_FEE_USDC || "0.02"
  ).trim();
  const feeUnits = ethers.parseUnits(feeStr, 6);
  const usdc = new ethers.Contract(usdcAddr, ERC20_MIN, relayerWallet);
  const relay = await relayerWallet.getAddress();
  const allowance = await usdc.allowance(payerAddress, relay);
  if (allowance < feeUnits) {
    throw new Error(
      `Recurring automation: approve USDC for relay ${relay} so the ${feeStr} usage fee can be sent to treasury (allowance too low).`
    );
  }
  const tx = await usdc.transferFrom(payerAddress, treasury, feeUnits);
  await tx.wait(1);
}

async function readAllowanceBestEffort(tokenContract, owner, spender) {
  try {
    const v = await tokenContract.allowance(owner, spender);
    return BigInt(v);
  } catch {
    // Some ARC testnet token wrappers can fail allowance() eth_call; keep flow resilient.
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

  const rpc = String(
    process.env.ARC_RPC_URL || process.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network"
  ).trim();
  const provider = new ethers.JsonRpcProvider(rpc);
  const relayer = new ethers.Wallet(key, provider);
  const gasTopUp = await ensureRelayerGasBudget(provider, relayer);

  const recipient = ethers.getAddress(recipientRaw);
  const payer = ethers.getAddress(String(schedule.payerAddress || "").trim());
  const tokenAddress = ethers.getAddress(String(schedule.tokenAddress || "").trim());

  await chargePrivpayUsageFeeRelay(relayer, payer);

  const tokenReader = new ethers.Contract(tokenAddress, ERC20_MIN, provider);
  const decimals = Number(await tokenReader.decimals().catch(() => 6));
  const amountUnits = ethers.parseUnits(String(schedule.amount), decimals);

  const poolRead = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const poolToken = await poolRead.token();
  if (ethers.getAddress(poolToken) !== tokenAddress) {
    throw new Error(`Pool expects token ${poolToken}; schedule uses ${tokenAddress}`);
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
  let tx;
  if (recurringAutomationAddress.startsWith("0x")) {
    const recurringAutomationChecksum = ethers.getAddress(recurringAutomationAddress);
    const authAllowance = await readAllowanceBestEffort(
      tokenReader,
      payer,
      recurringAutomationChecksum
    );
    if (authAllowance != null && authAllowance < amountUnits) {
      throw new Error(
        "Recurring authorization is active, but token allowance to RecurringPoolAutomation is too low."
      );
    }
    const recurringAutomation = new ethers.Contract(
      recurringAutomationChecksum,
      RECURRING_AUTOMATION_ABI,
      relayer
    );
    const strict =
      String(process.env.RECURRING_AUTOMATION_STRICT || "").toLowerCase() === "true";
    try {
      tx = await recurringAutomation.executePoolDeposit(authId, commitment, amountUnits);
    } catch (err) {
      if (strict) throw err;
      tx = await poolWrite.depositFor(payer, commitment, amountUnits);
    }
  } else {
    const poolAllowance = await readAllowanceBestEffort(tokenReader, payer, poolAddress);
    if (poolAllowance != null && poolAllowance < amountUnits) {
      throw new Error(
        `Recurring pool deposit: payer must approve the privacy pool for this token (allowance too low).`
      );
    }
    tx = await poolWrite.depositFor(payer, commitment, amountUnits);
  }
  const receipt = await tx.wait();

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
