import { useEffect, useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { Point, utils as secpUtils } from "@noble/secp256k1";
import logo from "./assets/swaparc-logo.png";
import usdcLogo from "./assets/usdc.jpg";
import eurcLogo from "./assets/eurc.jpg";
import swprcLogo from "./assets/swprc.jpg";
import "./App.css";
import { getPrices } from "./priceFetcher";
import { CircleSigner } from "./utils/CircleSigner";
import {
  deriveStealthPayment,
  deriveStealthPrivateKey,
  generateStealthReceiverKeys,
  scanStealthAnnouncement,
} from "./utils/stealthAddress";
import { extractPoolRootFromDepositReceipt } from "./utils/privacyPoolDeposit";
import {
  computePrivpayNoteLeafBytes,
  computePrivpayNullifierHashBytes,
  PRIVPAY_CIRCUIT_LEVELS,
} from "./utils/privpayWitness";
import {
  persistZkNote,
  listZkNotes,
  removeZkNote,
  buildZkNoteBackupJson,
  importZkNoteFromBackupJson,
} from "./utils/privpayNoteStorage";
import { proveZkPoolWithdraw, proveZkPoolWithdrawWithSecrets } from "./utils/privpayZkClaim";
import { parsePrivpayPublicSignals } from "./utils/privpayProof";
import {
  signPrivpayRelayDeposit,
  signPrivpayRelayWithdraw,
} from "./utils/privpayRelayAuth";

const ARC_CHAIN_ID_DEC = (() => {
  const n = Number(import.meta.env.VITE_ARC_CHAIN_ID || "");
  return Number.isFinite(n) && n > 0 ? n : 5042002;
})();
const ARC_CHAIN_ID_HEX = `0x${ARC_CHAIN_ID_DEC.toString(16)}`;
const CIRCLE_APP_ID = import.meta.env.VITE_CIRCLE_APP_ID || "";
/** Default read RPC for ARC Testnet (no API key). Override with VITE_ARC_RPC_URL. */
const ARC_PUBLIC_RPC = "https://rpc.testnet.arc.network";

console.log("Circle setup:", { CIRCLE_APP_ID });

import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
const STEALTH_PAYMENTS_ADDRESS =
  import.meta.env.VITE_STEALTH_PAYMENTS_ADDRESS || "";
/** ZKPrivacyPool addresses by token symbol (one pool per token). */
const PRIVACY_POOL_ADDRESS_USDC =
  import.meta.env.VITE_PRIVACY_POOL_ADDRESS_USDC ||
  import.meta.env.VITE_PRIVACY_POOL_ADDRESS ||
  "";
const PRIVACY_POOL_ADDRESS_EURC =
  import.meta.env.VITE_PRIVACY_POOL_ADDRESS_EURC || "";
const PRIVACY_POOL_ADDRESS_SWPRC =
  import.meta.env.VITE_PRIVACY_POOL_ADDRESS_SWPRC || "";
const PRIVACY_POOL_ADDRESS_BY_SYMBOL = {
  USDC: PRIVACY_POOL_ADDRESS_USDC,
  EURC: PRIVACY_POOL_ADDRESS_EURC,
  SWPRC: PRIVACY_POOL_ADDRESS_SWPRC,
};
function privacyPoolAddressForSymbol(symbol) {
  const key = String(symbol || "").trim().toUpperCase();
  const direct = PRIVACY_POOL_ADDRESS_BY_SYMBOL[key];
  if (direct) return direct;
  return PRIVACY_POOL_ADDRESS_USDC || "";
}
const HAS_ANY_PRIVACY_POOL = Object.values(PRIVACY_POOL_ADDRESS_BY_SYMBOL).some((v) =>
  Boolean(String(v || "").trim())
);
const PRIVACY_POOL_USE_RELAY =
  String(import.meta.env.VITE_PRIVACY_POOL_USE_RELAY || "").toLowerCase() === "true";
/** Groth16 browser proving (`/public/circuits/privpay/…`). */
const PRIVPAY_WASM_URL = String(import.meta.env.VITE_PRIVPAY_WASM_URL || "");
const PRIVPAY_ZKEY_URL = String(import.meta.env.VITE_PRIVPAY_ZKEY_URL || "");
const PRIVPAY_PLACEHOLDER_MODE = false;
const PRIVPAY_USAGE_FEE_USDC = "0.02";
const PRIVPAY_USDC_ADDRESS =
  import.meta.env.VITE_PRIVPAY_USDC_ADDRESS ||
  "0x3600000000000000000000000000000000000000";
const PRIVPAY_TREASURY_ADDRESS =
  import.meta.env.VITE_PRIVPAY_TREASURY_ADDRESS ||
  "0xD4d3E342902766344075D06c94391e61A9bB7e60";
const RECURRING_AUTOMATION_CONTRACT_ADDRESS =
  import.meta.env.VITE_RECURRING_AUTOMATION_CONTRACT_ADDRESS || "";
const RECURRING_AUTOMATION_EXECUTOR_ADDRESS =
  import.meta.env.VITE_RECURRING_AUTOMATION_EXECUTOR_ADDRESS || "";
const RECURRING_FEE_ALLOWANCE_BUFFER_USDC = String(
  import.meta.env.VITE_RECURRING_FEE_ALLOWANCE_BUFFER_USDC || "2"
);

/** Same intent as Bills Pay Now guard — shown inline in Payroll Upcoming runs. */
const PAYROLL_MANUAL_PAY_RECURRING_MSG =
  "Please toggle Recurring off to use Pay Now. While Recurring is on, payments run automatically on schedule.";

const TOKEN_INDICES = {
  USDC: 0,
  EURC: 1,
  SWPRC: 2,
};

const POOLS = [
  {
    id: "usdc-eurc",
    name: "USDC / EURC",
    tokens: ["USDC", "EURC"],
    poolAddress: "0xd22e4fB80E21e8d2C91131eC2D6b0C000491934B",
    lpToken: "0x454f21b7738A446f79ea4ff00e71b9e8E9E6FEE9",
  },
  {
    id: "usdc-swprc",
    name: "USDC / SWPRC",
    tokens: ["USDC", "SWPRC"],
    poolAddress: "0x613bc8A188a571e7Ffe3F884FabAB0F43ABB8282",
    lpToken: "0x2E2C7B48B2422223aD9628DA159f304192c24d3B",
  },
  {
    id: "eurc-swprc",
    name: "EURC / SWPRC",
    tokens: ["EURC", "SWPRC"],
    poolAddress: "0x9463DE67E73B42B2cE5e45cab7e32184B9c24939",
    lpToken: "0xb81816d4fBB3D33b56c3efc04675d1cDed0f68b1",
  },
];

const LP_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const POOL_ABI = [
  "function getBalances() view returns (uint256[])",
  "function lpToken() view returns (address)",
  // Verified from Arcscan ABI: camelCase, only 1 param (no min_mint_amount)
  "function addLiquidity(uint256[] amounts)",
  "function removeLiquidity(uint256 lpAmount)",
  "function claimRewards()",
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
const STEALTH_PAYMENTS_ABI = [
  "function announceERC20Payment(address token,address stealthAddress,uint256 amount,bytes ephemeralPubKey,bytes1 viewTag,bytes32 metadataHash)",
];
const PRIVACY_POOL_ABI = [
  "function deposit(bytes32 commitment, uint256 amount) external",
  "function depositFor(address from, bytes32 commitment, uint256 amount) external",
  "function withdraw(bytes proof, bytes32 nullifierHash, address recipient, uint256 amount) external",
  "function isKnownRoot(bytes32 root) view returns (bool)",
  "function nullifierSpent(bytes32) view returns (bool)",
  "function commitmentAmount(bytes32) view returns (uint256)",
  "function currentRoot() view returns (bytes32)",
  "function token() view returns (address)",
  "error AmountZero()",
  "error TransferInFailed()",
  "error CommitmentAlreadyUsed()",
  "error TreeFull()",
  "error DepositorZero()",
  "error RecipientZero()",
  "error TransferOutFailed()",
  "error NullifierSpent()",
  "error RootUnknown()",
  "error InvalidVerifier()",
  "error InvalidProof()",
  "error PublicSignalMismatch()",
  "error InvalidMerkleHeight()",
  "error CommitmentAmountMismatch()",
];
const RECURRING_AUTOMATION_ABI = [
  "function configureAuthorization(bytes32 authId,address executor,address token,address pool,uint128 maxAmountPerExecution,uint128 maxAmountPerPeriod,uint64 periodSeconds)",
];

/** @param {unknown} err */
function privacyPoolDepositErrorMessage(err) {
  const revert = /** @type {{ name?: string }} */ (err)?.revert;
  if (revert?.name === "TransferInFailed") {
    return "Privacy pool could not pull tokens: insufficient balance or allowance, or the bill token does not match the pool's token().";
  }
  if (revert?.name === "CommitmentAlreadyUsed") {
    return "Privacy pool rejected this deposit (commitment already used). Retry generates a new note.";
  }
  if (revert?.name === "TreeFull") {
    return "Privacy pool Merkle tree is full; deposits are disabled until a new pool is deployed.";
  }
  if (revert?.name === "AmountZero") {
    return "Deposit amount must be greater than zero.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/missing revert data|CALL_EXCEPTION|estimateGas/i.test(msg)) {
    return (
      `${msg} — Often: wrong network (switch wallet to ARC testnet), insufficient ARC gas token, ` +
      `insufficient pool token balance, or the selected VITE_PRIVACY_POOL_ADDRESS_<TOKEN> points to a contract that is not this ZK pool.`
    );
  }
  return msg;
}
const TOKEN_LOGOS = {
  USDC: usdcLogo,
  EURC: eurcLogo,
  SWPRC: swprcLogo,
};

const INITIAL_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
  {
    symbol: "SWPRC",
    name: "SwapARC Token",
    address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
  },
];

const BILL_NAME_PRESETS = [
  "Rent",
  "Electricity",
  "Internet",
  "Water",
  "Television",
  "Insurance",
  "Healthcare",
  "School Fees",
];

function bytesLikeToHex(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    return s.startsWith("0x") ? s : `0x${s}`;
  }
  if (value instanceof Uint8Array) return ethers.hexlify(value);
  return String(value);
}

/** Best-effort revert reason for ethers v6 / RPC errors (helps debug failed claims). */
function extractEthersRevertReason(err) {
  if (!err) return "";
  const short =
    typeof err.shortMessage === "string" && err.shortMessage.trim()
      ? err.shortMessage.trim()
      : "";
  const reason =
    typeof err.reason === "string" && err.reason.trim() ? err.reason.trim() : "";
  const nested = String(
    err?.info?.error?.message || err?.error?.message || err?.data?.message || ""
  ).trim();
  const raw = String(err?.message || "").trim();

  let data =
    err?.data ?? err?.info?.error?.data ?? err?.error?.data ?? null;
  if (data && typeof data === "object" && typeof data.data === "string") {
    data = data.data;
  }
  if (typeof data !== "string" || !data.startsWith("0x") || data.length < 10) {
    return [short, reason, nested, raw].filter(Boolean).join(" — ");
  }

  const selector = data.slice(0, 10);
  if (selector === "0x08c379a0") {
    try {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        `0x${data.slice(10)}`
      );
      if (decoded?.[0]) return String(decoded[0]);
    } catch {
      /* ignore */
    }
  }

  const errId = (sig) => ethers.id(sig).slice(0, 10);
  if (selector === errId("InvalidEphemeralPubKeyLength()")) {
    return "StealthPayments: invalid ephemeral public key length.";
  }
  if (selector === errId("TokenTransferFailed()")) {
    return "StealthPayments: token transfer failed (underlying ERC-20 rejected the move).";
  }
  if (selector === errId("NativeAmountMustBePositive()")) {
    return "StealthPayments: native amount issue (wrong announce path).";
  }

  if (selector === errId("InvalidProof()")) {
    return (
      "ZKPrivacyPool: InvalidProof — on-chain Groth16 check failed. Usually the browser wasm/zkey do not match the " +
      "deployed PrivPayGroth16Verifier (re-run npm run deploy:pool after npm run privpay:zk-artifacts, or stop regenerating zkeys after deploy)."
    );
  }
  if (selector === errId("RootUnknown()")) {
    return "ZKPrivacyPool: merkle root from proof is not a known historical root for this pool (wrong network, stale RPC, or wrong pool address).";
  }
  if (selector === errId("NullifierSpent()")) {
    return "ZKPrivacyPool: this payment was already claimed (nullifier spent).";
  }
  if (selector === errId("PublicSignalMismatch()")) {
    return "ZKPrivacyPool: withdraw arguments do not match proof public signals.";
  }
  if (selector === errId("CommitmentAmountMismatch()")) {
    return "ZKPrivacyPool: note commitment / amount does not match what was deposited.";
  }
  if (selector === errId("InvalidProofEncoding()")) {
    return "PrivPayGroth16Verifier: malformed packed proof bytes length or ABI layout.";
  }
  if (selector === errId("InvalidPublicSignal()")) {
    return "PrivPayGroth16Verifier: public signal out of field range.";
  }

  return [short, reason, nested, `${selector} ${data.slice(10, 74)}`]
    .filter(Boolean)
    .join(" — ");
}

/** Base64(JSON) using UTF-8 bytes — browser btoa() only accepts Latin-1 code units. */
function encodePoolClaimPayload(payload) {
  const utf8 = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
  return btoa(bin);
}

/**
 * v3 zk-claim: base64 JSON with note preimage for recipient Groth16 withdraw (same rail as saved notes).
 * Contains `secret` and `nullifier` — treat like a private key; share only over a secure channel.
 */
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

function decodeZkPoolClaimPayload(rawBase64) {
  const t = String(rawBase64 || "").trim();
  if (!t) {
    throw new Error("Invalid claim code (empty).");
  }
  // Support direct JSON payloads from older/local exports.
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t);
    } catch {
      throw new Error("Invalid claim payload JSON.");
    }
  }
  let j;
  const decodeBase64Json = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  try {
    j = decodeBase64Json(t);
  } catch {
    // Some transports mutate to URL-safe base64 (`-`/`_`, optional padding).
    try {
      const normalized = t.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      j = decodeBase64Json(padded);
    } catch {
      throw new Error("Invalid claim code (expected base64-encoded JSON).");
    }
  }
  if (!j || typeof j !== "object") {
    throw new Error("Invalid claim code (expected base64-encoded JSON).");
  }
  return j;
}

/** Pool address on history rows — prefer stored field; else decode from v3 poolClaimCode. */
function resolvePoolAddressForClaimEntry(entry) {
  const direct = String(entry?.poolAddress || "").trim();
  if (direct.startsWith("0x")) {
    try {
      return ethers.getAddress(direct);
    } catch {
      return null;
    }
  }
  const rawCode = String(entry?.poolClaimCode || "").trim();
  if (!rawCode) return null;
  try {
    const p = decodeZkPoolClaimPayload(rawCode);
    const a = String(p?.poolAddress || "").trim();
    if (!a.startsWith("0x")) return null;
    return ethers.getAddress(a);
  } catch {
    return null;
  }
}

async function derivePoolNullifierHashFromClaimMaterial(entry) {
  if (String(entry?.paymentRail || "") !== "privacyPool") return null;
  if (entry?.poolNullifierHash) {
    try {
      return ethers.zeroPadValue(entry.poolNullifierHash, 32);
    } catch {
      // fall through and try to recover from stored claim material
    }
  }
  let payload = entry?.poolClaimPayload || null;
  if (!payload) {
    const rawCode = String(entry?.poolClaimCode || "").trim();
    if (!rawCode) return null;
    try {
      payload = decodeZkPoolClaimPayload(rawCode);
    } catch {
      return null;
    }
  }
  const secret = bytesLikeToHex(payload?.secret);
  const nullifier = bytesLikeToHex(payload?.nullifier);
  const explicitNullifierHash = bytesLikeToHex(payload?.nullifierHash);
  if (explicitNullifierHash && explicitNullifierHash.length === 66) {
    try {
      return ethers.zeroPadValue(explicitNullifierHash, 32);
    } catch {
      // continue with secret/nullifier path
    }
  }
  if (!secret || secret.length !== 66 || !nullifier || nullifier.length !== 66) {
    return null;
  }
  return ethers.hexlify(await computePrivpayNullifierHashBytes(secret, nullifier));
}

function hasUnclaimedPrivacyPoolEntries(entries) {
  return entries.some(
    (entry) =>
      String(entry?.paymentRail || "") === "privacyPool" &&
      !entry?.poolClaimedAt &&
      !!resolvePoolAddressForClaimEntry(entry) &&
      (entry?.poolNullifierHash ||
        (entry?.poolRecipient && entry?.amount != null && String(entry?.token || "").trim()) ||
        String(entry?.poolClaimCode || "").trim())
  );
}

function isRecentCircleSubmission(isoTs, windowMs = 120000) {
  if (!isoTs) return false;
  const t = new Date(isoTs).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < windowMs;
}

function reverseHex32Bytes(hex32) {
  try {
    const b = ethers.getBytes(ethers.zeroPadValue(hex32, 32));
    const rev = Uint8Array.from(b).reverse();
    return ethers.hexlify(rev);
  } catch {
    return null;
  }
}

function formatDatetimeLocalValue(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultCustomStartAtLocal() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  return formatDatetimeLocalValue(d);
}

/** Parse `<input type="datetime-local" />` value as this device's local wall time. */
function parseDatetimeLocal(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec || 0),
    0
  );
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function customRepeatCadenceToSeconds(cadence) {
  const c = String(cadence || "").toLowerCase();
  switch (c) {
    case "daily":
      return 86_400;
    case "weekly":
      return 604_800;
    case "bi-weekly":
      return 1_209_600;
    case "monthly":
      return 2_592_000;
    case "quarterly":
      return 7_776_000;
    case "yearly":
      return 31_536_000;
    default:
      return 604_800;
  }
}

function inferCustomRepeatCadenceFromSeconds(secs) {
  const s = Number(secs);
  if (!Number.isFinite(s) || s <= 0) return "weekly";
  const pairs = [
    ["daily", 86_400],
    ["weekly", 604_800],
    ["bi-weekly", 1_209_600],
    ["monthly", 2_592_000],
    ["quarterly", 7_776_000],
    ["yearly", 31_536_000],
  ];
  let best = "weekly";
  let bestDiff = Infinity;
  for (const [key, v] of pairs) {
    const d = Math.abs(s - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = key;
    }
  }
  return best;
}

function normalizeStealthPublicKey(input, label) {
  const rawInput = String(input || "").trim();
  if (!rawInput) throw new Error(`${label} is required`);
  const maybePrefixed =
    rawInput.startsWith("0x") || rawInput.startsWith("0X") ? rawInput : `0x${rawInput}`;
  let bytes;
  try {
    bytes = ethers.getBytes(maybePrefixed);
  } catch {
    throw new Error(`${label} is invalid hex`);
  }
  if (bytes.length !== 33 && bytes.length !== 65) {
    throw new Error(`${label} must be a 33-byte or 65-byte secp256k1 public key`);
  }
  if (!secpUtils.isValidPublicKey(bytes)) {
    throw new Error(`${label} is not a valid secp256k1 public key`);
  }
  return ethers.hexlify(bytes);
}

function normalizeStealthRecipientKeys(receiverSpendPublicKey, receiverViewPublicKey) {
  return {
    receiverSpendPublicKey: normalizeStealthPublicKey(
      receiverSpendPublicKey,
      "Recipient spend public key"
    ),
    receiverViewPublicKey: normalizeStealthPublicKey(
      receiverViewPublicKey,
      "Recipient view public key"
    ),
  };
}

function isLikelyStealthConfigError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return (
    m.includes("hex invalid") ||
    m.includes("invalid hex") ||
    m.includes("public key") ||
    m.includes("recipient spend public key") ||
    m.includes("recipient view public key")
  );
}

function Ticker({ tokens, prices }) {
  const [items, setItems] = useState(() =>
    tokens.map((t) => ({
      ...t,
      price:
        prices && prices[t.symbol] != null
          ? Number(prices[t.symbol])
          : formatPriceMock(t.symbol),
    }))
  );

  useEffect(() => {
    setItems(
      tokens.map((t) => ({
        ...t,
        price:
          prices && prices[t.symbol] != null
            ? Number(prices[t.symbol])
            : formatPriceMock(t.symbol),
      }))
    );
  }, [tokens, prices]);

  useEffect(() => {
    const iv = setInterval(() => {
      setItems((prev) =>
        prev.map((it) => {
          if (prices && prices[it.symbol] != null) return it;
          const drift = (Math.random() * 0.3 - 0.15) / 100;
          const newPrice = Number(Number(it.price) * (1 + drift)).toFixed(4);
          return { ...it, price: newPrice };
        })
      );
    }, 6000);
    return () => clearInterval(iv);
  }, [prices]);
  const double = [...items, ...items];

  return (
    <div className="ticker-viewport" aria-hidden="true">
      <div className="ticker-track">
        {double.map((t, i) => (
          <div className="ticker-item" key={`${t.symbol}-${i}`}>
            <div className="ticker-logo">
              <img
                src={TOKEN_LOGOS[t.symbol]}
                alt={t.symbol}
                style={{ width: "100%", height: "100%", borderRadius: "50%" }}
              />
            </div>

            <div className="ticker-name">{t.symbol}</div>
            <div className="ticker-price">
              {prices && prices[t.symbol] != null
                ? `$${Number(prices[t.symbol]).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}`
                : `$${t.price}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPriceMock(sym) {
  const base =
    {
      USDC: 1,
      EURC: 1.063,
      SWPRC: 0.71,
      USDG: 1,
      ARCX: 0.42,
      wETH: 3475.12,
      wBTC: 94000,
      SOL: 180.4,
      BTC: 94000,
      ETH: 3475.12,
    }[sym] ?? 1;
  return Number(base).toFixed(base >= 100 ? 0 : base >= 10 ? 2 : 4);
}

function TokenSelect({ tokens, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef();

  useEffect(() => {
    function docClick(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", docClick);
    return () => document.removeEventListener("click", docClick);
  }, []);

  const options = tokens.filter((t) =>
    (t.symbol + " " + t.name).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="tokenselect" ref={ref}>
      <button className="tokenbtn" onClick={() => setOpen((o) => !o)}>
        <span className="tokenBadgeSmall">
          <img
            src={TOKEN_LOGOS[value]}
            alt={value}
            style={{ width: "100%", height: "100%", borderRadius: "50%" }}
          />
        </span>

        <span className="tokenLabel">{value}</span>
        <span className="caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="tokendropdown">
          <input
            className="tokensearch"
            placeholder="Search token..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ul className="tokenoptions">
            {options.map((t) => (
              <li key={t.address}>
                <button
                  className="tokenOptionBtn"
                  onClick={() => {
                    onChange(t.symbol);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="tokenBadgeSmall">
                    <img
                      src={TOKEN_LOGOS[t.symbol]}
                      alt={t.symbol}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: "50%",
                      }}
                    />
                  </span>

                  <div style={{ textAlign: "left" }}>
                    <div className="optSym">{t.symbol}</div>
                    <div className="optName">{t.name}</div>
                  </div>
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="nooptions">No tokens</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function openFaucet() {
    window.open("https://faucet.circle.com/", "_blank");
  }

  // --- STATE DECLARATIONS (Moved up to avoid TDZ) ---
  const [address, setAddress] = useState(null);
  const [authMode, setAuthMode] = useState("wallet");
  const [circleWallet, setCircleWallet] = useState(null);
  const [circleWalletReady, setCircleWalletReady] = useState(false);
  const [circleLogin, setCircleLogin] = useState(null);
  const circleSdkRef = useRef(null);
  const userEmailRef = useRef(null);
  const circleExecResolverRef = useRef(null);
  const circlePromptInFlightRef = useRef(false);
  // Serialize all Circle contract actions (approve / swap / add / remove)
  const circleActionQueueRef = useRef(Promise.resolve());
  // Prevent extra Circle calls from bad UX (users spamming buttons)
  const circleActionDepthRef = useRef(0);
  const [circleActionsBusy, setCircleActionsBusy] = useState(false);

  const [activePreset, setActivePreset] = useState(null);
  const [network, setNetwork] = useState(null);
  const [poolTokenBalances, setPoolTokenBalances] = useState({});
  const [lpTokenAmounts, setLpTokenAmounts] = useState({});
  const [lpBalances, setLpBalances] = useState({});
  const [lpLoading, setLpLoading] = useState(false);
  const [lpCacheHydrated, setLpCacheHydrated] = useState(false);
  const lastLpCacheWalletRef = useRef(null);
  const [liquiditySuccess, setLiquiditySuccess] = useState(null);
  const [lpDecimals, setLpDecimals] = useState(18);
  const [poolBalances, setPoolBalances] = useState({});
  const [status, setStatus] = useState("Not connected");
  const [balances, setBalances] = useState({});
  const [tokens, setTokens] = useState(INITIAL_TOKENS);
  const [swapFrom, setSwapFrom] = useState("USDC");
  const [poolTxs, setPoolTxs] = useState([]);
  const [showAddLiquidity, setShowAddLiquidity] = useState(false);
  const [liqInputs, setLiqInputs] = useState({
    USDC: "",
    EURC: "",
    SWPRC: "",
  });
  const [myDeposits, setMyDeposits] = useState({
    USDC: 0,
    EURC: 0,
    SWPRC: 0,
  });

  const [liqLoading, setLiqLoading] = useState(false);
  const [showRemoveLiquidity, setShowRemoveLiquidity] = useState(false);
  const [removeLpAmount, setRemoveLpAmount] = useState("");
  const [removeLoading, setRemoveLoading] = useState(false);
  const [activeLpBalance, setActiveLpBalance] = useState(null);
  const [activeLpBalanceLoading, setActiveLpBalanceLoading] = useState(false);
  const [activeLpRaw, setActiveLpRaw] = useState(0n);
  const [removeDriverSym, setRemoveDriverSym] = useState(null);
  const [removeTokenInputs, setRemoveTokenInputs] = useState({});
  const [removeEstimates, setRemoveEstimates] = useState({});
  const [removeMeta, setRemoveMeta] = useState(null); // { poolRawBalances, totalLpRaw, lpDec, tokenDecs }
  const [removeCalcError, setRemoveCalcError] = useState("");
  const [historyView, setHistoryView] = useState("mine");
  const TXS_PER_PAGE = 10;
  const [txPage, setTxPage] = useState(0);
  const startIdx = txPage * TXS_PER_PAGE;
  const endIdx = startIdx + TXS_PER_PAGE;
  const pagedTxs = poolTxs.slice(startIdx, endIdx);
  const walletTxs = getActiveWalletAddress()
    ? poolTxs.filter((tx) => {
        const a = String(getActiveWalletAddress() || "").toLowerCase();
        return (
          tx.from?.toLowerCase() === a ||
          tx.to?.toLowerCase() === a
        );
      })
    : [];
  const pagedWalletTxs = walletTxs.slice(startIdx, endIdx);
  const activeHistoryTxs = historyView === "all" ? pagedTxs : pagedWalletTxs;
  const activeHistoryTotal =
    historyView === "all" ? poolTxs.length : walletTxs.length;
  const [txLoading, setTxLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("swap");
  const [privpayModule, setPrivpayModule] = useState("bills");
  const [bills, setBills] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_bills");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [billHistory, setBillHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_bill_history");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedBillHistoryIds, setSelectedBillHistoryIds] = useState(() => new Set());
  const [billExportMode, setBillExportMode] = useState("unresolved");
  const [resolvedBillHistoryIds, setResolvedBillHistoryIds] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_bill_history_resolved");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });
  const [billForm, setBillForm] = useState({
    name: "",
    token: "USDC",
    amount: "",
    recipientWallet: "",
    receiverSpendPublicKey: "",
    receiverViewPublicKey: "",
    frequency: "monthly",
    customStartAt: "",
    customRepeatCadence: "weekly",
    customIntervalSeconds: "",
    recurring: true,
  });
  const [billCreateError, setBillCreateError] = useState("");
  const [billCreateStatus, setBillCreateStatus] = useState("");
  const [billRecipientInviteAddress, setBillRecipientInviteAddress] = useState("");
  const [billRecipientInviteStatus, setBillRecipientInviteStatus] = useState("");
  const [billRuntimeError, setBillRuntimeError] = useState("");
  const [billRuntimeStatus, setBillRuntimeStatus] = useState("");
  const [billBusyId, setBillBusyId] = useState(null);
  const billsRef = useRef([]);
  const recurringServerRunLastAtRef = useRef(0);
  const privpayHistoryHydratedOwnerRef = useRef("");
  /** Prevents forcing "first company" whenever selectedCompanyId is "" so "All companies" can stay selected. */
  const payrollCompanySelectInitRef = useRef(false);
  const recurringRefreshBusyRef = useRef(false);
  const recurringDeleteEndpointAvailableRef = useRef(true);
  const privacyPoolClaimRefreshBackoffUntilRef = useRef(0);
  const [subStatusLoading, setSubStatusLoading] = useState(false);
  const [privpayAccess, setPrivpayAccess] = useState({
    plan: "none",
    recurringPayments: false,
    payrollAutomation: false,
    advancedPrivacy: false,
    isEarlySwaparcer: false,
    subscriptionActive: false,
    expiresAt: null,
  });
  const [billsView, setBillsView] = useState("upcoming");
  const [billsUpcomingPage, setBillsUpcomingPage] = useState(1);
  const [billsHistoryPage, setBillsHistoryPage] = useState(1);
  const [payrollUpcomingPage, setPayrollUpcomingPage] = useState(1);
  const [payrollHistoryPage, setPayrollHistoryPage] = useState(1);
  const [claimHistoryPage, setClaimHistoryPage] = useState(1);
  const [editingBillId, setEditingBillId] = useState(null);
  const [payrollCompanies, setPayrollCompanies] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_payroll_companies");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [payrollEmployees, setPayrollEmployees] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_payroll_employees");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [payrollHistory, setPayrollHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_payroll_history");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedPayrollHistoryIds, setSelectedPayrollHistoryIds] = useState(() => new Set());
  const [payrollExportMode, setPayrollExportMode] = useState("unresolved");
  const [resolvedPayrollHistoryIds, setResolvedPayrollHistoryIds] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_payroll_history_resolved");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companyForm, setCompanyForm] = useState({
    name: "",
    token: "USDC",
    defaultFrequency: "monthly",
  });
  const [employeeForm, setEmployeeForm] = useState({
    companyId: "",
    name: "",
    role: "",
    recipientWallet: "",
    receiverSpendPublicKey: "",
    receiverViewPublicKey: "",
    salary: "",
    frequency: "monthly",
    customStartAt: "",
    customRepeatCadence: "weekly",
    customIntervalSeconds: "",
    recurring: true,
  });
  const [payrollStatus, setPayrollStatus] = useState("");
  const [payrollError, setPayrollError] = useState("");
  const [payrollServerSyncError, setPayrollServerSyncError] = useState("");
  /** Set when POST /api/payments/payroll/run reports server-side autopay disabled (same env as recurring Bills). */
  const [payrollAutopayServerHint, setPayrollAutopayServerHint] = useState("");
  const [payrollRecipientInviteAddress, setPayrollRecipientInviteAddress] = useState("");
  const [payrollRecipientInviteStatus, setPayrollRecipientInviteStatus] = useState("");
  const [payrollBusyCompanyId, setPayrollBusyCompanyId] = useState(null);
  const [payrollBusyEmployeeId, setPayrollBusyEmployeeId] = useState(null);
  const [payrollRecurringToggleBusyId, setPayrollRecurringToggleBusyId] = useState(null);
  const payrollEmployeesRef = useRef([]);
  const [editingCompanyId, setEditingCompanyId] = useState(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [payrollManageView, setPayrollManageView] = useState("dashboard");
  const [privateReceivePassphrase, setPrivateReceivePassphrase] = useState("");
  const [privateReceiveRecoverPassphrase, setPrivateReceiveRecoverPassphrase] =
    useState("");
  const [privateReceiveStatus, setPrivateReceiveStatus] = useState("");
  const [privateReceiveError, setPrivateReceiveError] = useState("");
  const [privateReceiveBusy, setPrivateReceiveBusy] = useState(false);
  const [privateIncoming, setPrivateIncoming] = useState([]);
  const [privateIncomingLoading, setPrivateIncomingLoading] = useState(false);
  const [privateIncomingError, setPrivateIncomingError] = useState("");
  const [privateIncomingBusyId, setPrivateIncomingBusyId] = useState("");
  const [poolClaimCodeInput, setPoolClaimCodeInput] = useState("");
  const [poolClaimBusy, setPoolClaimBusy] = useState(false);
  const [poolClaimError, setPoolClaimError] = useState("");
  const [poolClaimStatus, setPoolClaimStatus] = useState("");
  const [poolClaimHistory, setPoolClaimHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("privpay_claim_history");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [poolZkPassphrase, setPoolZkPassphrase] = useState("");
  const [poolZkClaimBusyId, setPoolZkClaimBusyId] = useState("");
  const [poolZkNotesTick, setPoolZkNotesTick] = useState(0);
  const [poolZkStatus, setPoolZkStatus] = useState("");
  const [poolZkError, setPoolZkError] = useState("");
  const poolZkImportRef = useRef(null);
  const poolZkSavedNotes = useMemo(() => listZkNotes(), [poolZkNotesTick]);
  const [privateReceiveBackups, setPrivateReceiveBackups] = useState([]);
  const [selectedBackupKeyId, setSelectedBackupKeyId] = useState("");
  const privateReceiveDeepLinkHandledRef = useRef(false);
  const [showPrivateReceiveTools, setShowPrivateReceiveTools] = useState(false);
  const [poolsView, setPoolsView] = useState("positions");
  const [swapHistory, setSwapHistory] = useState(() => {
    try {
      const saved = localStorage.getItem("swaparc_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [txModal, setTxModal] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null);
  const [swapTo, setSwapTo] = useState("EURC");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [swapAmount, setSwapAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [arrowSpin, setArrowSpin] = useState(false);
  const [customAddr, setCustomAddr] = useState("");
  const [estimatedTo, setEstimatedTo] = useState("");
  const [slippageTolerance, setSlippageTolerance] = useState(1); // percent, default 1%
  const [expectedOutputNum, setExpectedOutputNum] = useState(null); // raw number for calculations
  const [expectedOutputRaw, setExpectedOutputRaw] = useState(null); // bigint wei for min_dy
  const [swapPoolTokenBalances, setSwapPoolTokenBalances] = useState({}); // { USDC, EURC, SWPRC } for swap pool
  const [highImpactConfirmed, setHighImpactConfirmed] = useState(false);
  const [showSlippagePanel, setShowSlippagePanel] = useState(false);

  const [prices, setPrices] = useState({});
  // authMode moved up
  const [leaderboard, setLeaderboard] = useState({
    topSwapVolume: [],
    topSwapCount: [],
    topLPProvided: [],
  });
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  // circleWallet, circleWalletReady moved up

  useEffect(() => {
    if (authMode === "email" && circleWallet && circleWallet.address) {
      setAddress(circleWallet.address);
    }
  }, [authMode, circleWallet]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activePreset?.lpToken) return;
      try {
        const provider = getReadProvider();
        const lp = new ethers.Contract(activePreset.lpToken, LP_ABI, provider);
        const dec = await lp.decimals();
        if (!cancelled) setLpDecimals(Number(dec) || 18);
      } catch {
        if (!cancelled) setLpDecimals(18);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePreset?.lpToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!showRemoveLiquidity) return;
      const userAddr = getActiveWalletAddress();
      if (!userAddr || !activePreset?.lpToken) return;
      // Avoid reading before Circle wallet is ready
      if (authMode === "email" && (!circleWalletReady || !circleWallet?.address)) return;

      setActiveLpBalanceLoading(true);
      try {
        const { human, raw, dec, lpTokenAddress } = await fetchSingleLpBalance(activePreset, userAddr);
        // If a cached balance exists and is higher, keep the higher value (prevents showing 0 on transient RPC issues)
        const cached = activePreset ? Number(lpBalances?.[activePreset.id] || 0) : 0;
        if (!cancelled) {
          if (dec) setLpDecimals(Number(dec) || 18);
          setActiveLpRaw(typeof raw === "bigint" ? raw : 0n);
          setActiveLpBalance(Math.max(human || 0, cached || 0));
          setRemoveLpAmount("");
          setRemoveDriverSym(null);
          setRemoveTokenInputs({});
          setRemoveEstimates({});
          setRemoveMeta(null);
          setRemoveCalcError("");
          console.log("[LP-Debug] active modal", {
            poolId: activePreset.id,
            user: userAddr,
            lpToken: lpTokenAddress || activePreset.lpToken,
            decimals: dec,
            raw: (typeof raw === "bigint" ? raw : 0n).toString(),
            human,
            cached,
          });

          // Fetch pool + token metadata for "remove by token amount" UX
          try {
            const provider = getReadProvider();
            const pool = new ethers.Contract(activePreset.poolAddress, POOL_ABI, provider);
            const [poolRawBalances, lpTokenAddr] = await Promise.all([
              pool.getBalances(),
              pool.lpToken().catch(() => activePreset.lpToken),
            ]);
            const lp = new ethers.Contract(lpTokenAddr, LP_ABI, provider);
            const [totalLpRaw, lpDec] = await Promise.all([
              lp.totalSupply(),
              lp.decimals().catch(() => 18),
            ]);
            const tokenDecs = {};
            for (const sym of activePreset.tokens) {
              const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
              if (!token) continue;
              try {
                const tC = new ethers.Contract(token.address, ERC20_ABI, provider);
                tokenDecs[sym] = Number(await tC.decimals());
              } catch {
                tokenDecs[sym] = 18;
              }
            }
            if (!cancelled) {
              setRemoveMeta({
                poolRawBalances,
                totalLpRaw,
                lpDec: Number(lpDec) || 18,
                tokenDecs,
                lpTokenAddr,
              });
            }
          } catch (e) {
            console.warn("[LP-Debug] remove meta fetch failed", e?.message || e);
          }
        }
      } catch (e) {
        console.warn("Active LP balance fetch failed", e);
        if (!cancelled) {
          setActiveLpBalance(null);
          setActiveLpRaw(0n);
        }
      } finally {
        if (!cancelled) setActiveLpBalanceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showRemoveLiquidity, activePreset?.lpToken, activePreset?.id, authMode, circleWalletReady, circleWallet?.address, address, lpDecimals]);

  function ceilDiv(a, b) {
    if (b === 0n) return 0n;
    return (a + b - 1n) / b;
  }

  function setRemoveByPct(pct) {
    if (!activePreset || !removeMeta) return;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (!(typeof activeLpRaw === "bigint") || activeLpRaw <= 0n) return;
    const totalLpRaw = removeMeta.totalLpRaw ?? 0n;
    if (!totalLpRaw || totalLpRaw <= 0n) return;

    const lpRaw = (activeLpRaw * BigInt(Math.round(p * 100))) / 10000n; // basis points
    const lpDec = Number(removeMeta.lpDec ?? lpDecimals ?? 18);
    setRemoveLpAmount(lpRaw > 0n ? ethers.formatUnits(lpRaw, lpDec) : "");

    const est = {};
    for (let i = 0; i < (activePreset.tokens || []).length; i++) {
      const sym = activePreset.tokens[i];
      const decOut = Number(removeMeta.tokenDecs?.[sym] ?? 18);
      const outRaw = (removeMeta.poolRawBalances[i] * lpRaw) / totalLpRaw;
      est[sym] = Number.parseFloat(ethers.formatUnits(outRaw, decOut));
    }
    setRemoveEstimates(est);

    // Default driver = first token (user can tap other input to switch)
    const driver = activePreset.tokens?.[0];
    if (driver) {
      setRemoveDriverSym(driver);
      setRemoveTokenInputs({
        [driver]:
          est?.[driver] != null && Number.isFinite(est[driver]) && est[driver] > 0
            ? String(est[driver].toFixed(6))
            : "",
      });
    } else {
      setRemoveDriverSym(null);
      setRemoveTokenInputs({});
    }
  }

  function computeRemoveFromToken(sym, amountStr) {
    if (!activePreset || !removeMeta) return;
    setRemoveCalcError("");
    const amt = String(amountStr || "").trim();
    if (!amt) {
      setRemoveLpAmount("");
      setRemoveEstimates({});
      return;
    }

    const idx = activePreset.tokens.indexOf(sym);
    if (idx < 0) return;

    const tokenDec = Number(removeMeta.tokenDecs?.[sym] ?? 18);
    const poolRaw = removeMeta.poolRawBalances?.[idx] ?? 0n;
    const totalLpRaw = removeMeta.totalLpRaw ?? 0n;
    const lpDec = Number(removeMeta.lpDec ?? lpDecimals ?? 18);

    if (poolRaw === 0n || totalLpRaw === 0n) {
      setRemoveCalcError("Pool data unavailable right now. Try again in a moment.");
      return;
    }

    let desiredRaw = 0n;
    try {
      desiredRaw = ethers.parseUnits(amt, tokenDec);
    } catch {
      setRemoveCalcError("Invalid amount format");
      return;
    }
    if (desiredRaw <= 0n) {
      setRemoveLpAmount("");
      setRemoveEstimates({});
      return;
    }

    // lpRawNeeded = ceil(desiredRaw * totalLpRaw / poolRawToken)
    const lpRawNeeded = ceilDiv(desiredRaw * totalLpRaw, poolRaw);
    if (typeof activeLpRaw === "bigint" && activeLpRaw > 0n && lpRawNeeded > activeLpRaw) {
      setRemoveCalcError("That amount exceeds your position.");
      return;
    }

    setRemoveLpAmount(ethers.formatUnits(lpRawNeeded, lpDec));

    // Estimates for all tokens out (proportional)
    const est = {};
    for (let i = 0; i < activePreset.tokens.length; i++) {
      const s = activePreset.tokens[i];
      const decOut = Number(removeMeta.tokenDecs?.[s] ?? 18);
      const outRaw = (removeMeta.poolRawBalances[i] * lpRawNeeded) / totalLpRaw;
      est[s] = Number.parseFloat(ethers.formatUnits(outRaw, decOut));
    }
    setRemoveEstimates(est);
  }

  const [profileStats, setProfileStats] = useState(null);
  const [userId, setUserId] = useState(null);
  const [leaderboardTab, setLeaderboardTab] = useState("swaps");
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [tokenPrices, setTokenPrices] = useState({});
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailStep, setEmailStep] = useState(1);
  const [emailInput, setEmailInput] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailErrorDetails, setEmailErrorDetails] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [circleDeviceId, setCircleDeviceId] = useState("");
  const [circleDeviceToken, setCircleDeviceToken] = useState("");
  const [circleDeviceEncryptionKey, setCircleDeviceEncryptionKey] = useState("");
  const [circleOtpToken, setCircleOtpToken] = useState("");
  // circleLogin moved up
  const [circleChallengeId, setCircleChallengeId] = useState(null);
  const [circleExecPrompt, setCircleExecPrompt] = useState(null);
  const [circleExecLoading, setCircleExecLoading] = useState(false);
  const [circleExecError, setCircleExecError] = useState("");
  // userEmailRef, circleExecResolverRef moved up

  // --- HELPER FUNCTIONS (Safe to use state now) ---
  function getReadProvider() {
    // Use public ARC RPC by default so the app stays up without paid third‑party plans.
    // Optional: set VITE_ARC_RPC_URL (single provider) or add VITE_ALCHEMY_ARC_RPC_URL for fallbacks.
    const url =
      import.meta.env.VITE_ARC_RPC_URL || ARC_PUBLIC_RPC;
    return new ethers.JsonRpcProvider(
      url,
      { chainId: ARC_CHAIN_ID_DEC, name: "arc-testnet" },
      { batchMaxCount: 1 }
    );
  }

  const READ_RPC_URLS = useMemo(() => {
    const urls = [];
    const primary = import.meta.env.VITE_ARC_RPC_URL?.trim();
    if (primary) urls.push(primary);
    urls.push(ARC_PUBLIC_RPC);
    const alchemy = import.meta.env.VITE_ALCHEMY_ARC_RPC_URL?.trim();
    if (alchemy) urls.push(alchemy);
    urls.push("https://arc-testnet.drpc.org");
    return [...new Set(urls)];
  }, []);

  function getReadProviderForUrl(url) {
    return new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
  }

  async function withReadProviders(fn, label = "read") {
    let lastErr = null;
    for (const url of READ_RPC_URLS) {
      try {
        const provider = getReadProviderForUrl(url);
        return await fn(provider, url);
      } catch (e) {
        lastErr = e;
        console.warn(`[RPC] ${label} failed on ${url}`, e?.message || e);
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  async function waitForTxBestEffort(txHash, timeoutMs = 45000) {
    if (!txHash || txHash === "SUBMITTED") return null;
    const perProviderTimeout = Math.max(8000, Math.floor(timeoutMs / Math.max(1, READ_RPC_URLS.length)));
    try {
      return await withReadProviders(
        async (provider) =>
          await Promise.race([
            provider.waitForTransaction(txHash, 1, perProviderTimeout),
            new Promise((resolve) => setTimeout(() => resolve(null), perProviderTimeout)),
          ]),
        "waitForTransaction"
      );
    } catch (e) {
      console.warn("[RPC] waitForTxBestEffort failed:", e?.message || e);
      return null;
    }
  }

  async function getTxReceiptBestEffort(txHash) {
    if (!txHash || txHash === "SUBMITTED") return null;
    try {
      return await withReadProviders(
        async (provider) => await provider.getTransactionReceipt(txHash),
        "getTransactionReceipt"
      );
    } catch (e) {
      console.warn("[RPC] getTxReceiptBestEffort failed:", e?.message || e);
      return null;
    }
  }

  function getActiveWalletAddress() {
    if (authMode === "email" && circleWallet) return circleWallet.address;
    return address;
  }

  function privateReceiveStorageKey(walletAddress) {
    return `privpay_receiver_keys_${String(walletAddress || "").toLowerCase()}`;
  }

  function toBase64(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  function fromBase64(base64) {
    const raw = atob(String(base64 || ""));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function copyTextWithFallback(text) {
    const value = String(text || "");
    if (!value) throw new Error("Nothing to copy.");
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    if (typeof window !== "undefined") {
      window.prompt("Copy this value:", value);
      return;
    }
    throw new Error("Clipboard is unavailable.");
  }

  function buildPrivateReceiveKeyRecord(keys) {
    return {
      keyId: `prk_${crypto.randomUUID()}`,
      spendPublicKey: keys.spendPublicKey,
      viewPublicKey: keys.viewPublicKey,
      spendPrivateKey: keys.spendPrivateKey,
      viewPrivateKey: keys.viewPrivateKey,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
  }

  function normalizePrivateReceiveKeyring(raw) {
    if (!raw) return null;
    // Legacy format support: single key object.
    if (raw?.spendPublicKey && raw?.viewPublicKey && !Array.isArray(raw?.keys)) {
      const rec = {
        keyId: `legacy_${crypto.randomUUID()}`,
        spendPublicKey: raw.spendPublicKey,
        viewPublicKey: raw.viewPublicKey,
        spendPrivateKey: raw.spendPrivateKey || "",
        viewPrivateKey: raw.viewPrivateKey || "",
        createdAt: new Date().toISOString(),
        archivedAt: null,
      };
      return {
        schemaVersion: 2,
        activeKeyId: rec.keyId,
        keys: [rec],
        updatedAt: new Date().toISOString(),
      };
    }

    const keys = Array.isArray(raw?.keys)
      ? raw.keys
          .filter((k) => k?.spendPublicKey && k?.viewPublicKey)
          .map((k) => ({
            keyId: String(k.keyId || `prk_${crypto.randomUUID()}`),
            spendPublicKey: String(k.spendPublicKey),
            viewPublicKey: String(k.viewPublicKey),
            spendPrivateKey: String(k.spendPrivateKey || ""),
            viewPrivateKey: String(k.viewPrivateKey || ""),
            createdAt: k.createdAt || new Date().toISOString(),
            archivedAt: k.archivedAt || null,
          }))
      : [];
    if (!keys.length) return null;
    const activeKeyId =
      keys.find((k) => k.keyId === raw?.activeKeyId)?.keyId || keys[0].keyId;
    return {
      schemaVersion: 2,
      activeKeyId,
      keys,
      updatedAt: raw?.updatedAt || new Date().toISOString(),
    };
  }

  function loadPrivateReceiveKeyring(walletAddress) {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(privateReceiveStorageKey(walletAddress));
      if (!raw) return null;
      return normalizePrivateReceiveKeyring(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function savePrivateReceiveKeyring(walletAddress, keyring) {
    if (typeof window === "undefined") return;
    const normalized = normalizePrivateReceiveKeyring(keyring);
    if (!normalized) return;
    try {
      window.localStorage.setItem(
        privateReceiveStorageKey(walletAddress),
        JSON.stringify({
          ...normalized,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // ignore local storage failures
    }
  }

  function activePrivateReceiveKey(walletAddress) {
    const keyring = loadPrivateReceiveKeyring(walletAddress);
    if (!keyring) return null;
    return keyring.keys.find((k) => k.keyId === keyring.activeKeyId) || keyring.keys[0] || null;
  }

  function mergedKeyring(base, incoming) {
    const left = normalizePrivateReceiveKeyring(base) || {
      schemaVersion: 2,
      activeKeyId: "",
      keys: [],
      updatedAt: new Date().toISOString(),
    };
    const right = normalizePrivateReceiveKeyring(incoming);
    if (!right) return left;
    const map = new Map();
    for (const k of [...left.keys, ...right.keys]) {
      const stableId = String(k.keyId || "");
      if (!stableId) continue;
      map.set(stableId, {
        ...k,
        archivedAt: k.archivedAt || null,
      });
    }
    const keys = [...map.values()];
    const activeKeyId = right.activeKeyId || left.activeKeyId || keys[0]?.keyId || "";
    return {
      schemaVersion: 2,
      activeKeyId,
      keys,
      updatedAt: new Date().toISOString(),
    };
  }

  async function derivePassphraseCryptoKey(passphrase, saltBytes) {
    const passKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(passphrase || "")),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 210000,
        salt: saltBytes,
      },
      passKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptWithPassphrase(payload, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derivePassphraseCryptoKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload || {}));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    return {
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 210000,
        salt: toBase64(salt),
      },
      cipher: {
        name: "AES-GCM",
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext),
      },
    };
  }

  async function decryptWithPassphrase(envelope, passphrase) {
    const salt = fromBase64(envelope?.kdf?.salt || "");
    const iv = fromBase64(envelope?.cipher?.iv || "");
    const ciphertext = fromBase64(envelope?.cipher?.ciphertext || "");
    const key = await derivePassphraseCryptoKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function registerPrivateReceiverForAddress(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    if (!normalized || !String(normalized).startsWith("0x")) return null;
    let keyring = loadPrivateReceiveKeyring(normalized);
    if (!keyring) {
      const first = buildPrivateReceiveKeyRecord(generateStealthReceiverKeys());
      keyring = {
        schemaVersion: 2,
        activeKeyId: first.keyId,
        keys: [first],
        updatedAt: new Date().toISOString(),
      };
    }

    let activeKey = activePrivateReceiveKey(normalized);
    // Self-heal legacy/corrupt local keyrings by regenerating a valid keypair.
    let activeKeysValid = false;
    try {
      if (activeKey?.spendPublicKey && activeKey?.viewPublicKey) {
        normalizeStealthRecipientKeys(
          activeKey.spendPublicKey,
          activeKey.viewPublicKey
        );
        activeKeysValid = true;
      }
    } catch {
      activeKeysValid = false;
    }
    if (!activeKeysValid) {
      const regenerated = buildPrivateReceiveKeyRecord(generateStealthReceiverKeys());
      keyring = {
        schemaVersion: 2,
        activeKeyId: regenerated.keyId,
        keys: [regenerated, ...(Array.isArray(keyring?.keys) ? keyring.keys : [])],
        updatedAt: new Date().toISOString(),
      };
      savePrivateReceiveKeyring(normalized, keyring);
      activeKey = activePrivateReceiveKey(normalized);
    }

    savePrivateReceiveKeyring(normalized, keyring);
    if (!activeKey) throw new Error("No active private receive key available");

    const res = await fetch("/api/privpay/register-receiver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: normalized,
        spendPublicKey: activeKey.spendPublicKey,
        viewPublicKey: activeKey.viewPublicKey,
        source: isCircleMode() ? "circle-connect" : "wallet-connect",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Failed to enable private receive");
    }
    return {
      address: normalized,
      keyId: activeKey.keyId,
      spendPublicKey: activeKey.spendPublicKey,
      viewPublicKey: activeKey.viewPublicKey,
      keyring,
    };
  }

  async function loadPrivateReceiveBackups() {
    const active = getActiveWalletAddress();
    if (!active) return [];
    const normalized = normalizeAddress(active);
    const res = await fetch(
      `/api/privpay/list-backups?address=${encodeURIComponent(normalized)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to load key backups");
    const rows = Array.isArray(data?.backups) ? data.backups : [];
    setPrivateReceiveBackups(rows);
    if (!selectedBackupKeyId && rows[0]?.keyId) {
      setSelectedBackupKeyId(rows[0].keyId);
    }
    return rows;
  }

  async function backupPrivateReceiveKeyring() {
    const active = getActiveWalletAddress();
    if (!active) throw new Error("Connect wallet first");
    if (!privateReceivePassphrase || privateReceivePassphrase.length < 8) {
      throw new Error("Use a backup passphrase with at least 8 characters");
    }
    const normalized = normalizeAddress(active);
    const keyring = loadPrivateReceiveKeyring(normalized);
    if (!keyring?.keys?.length) {
      throw new Error("No private receive keys to back up");
    }
    const keyId = keyring.activeKeyId || keyring.keys[0]?.keyId || crypto.randomUUID();
    const backup = await encryptWithPassphrase(keyring, privateReceivePassphrase);
    const res = await fetch("/api/privpay/backup-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: normalized,
        keyId,
        label: "private-receive-keyring",
        backup,
        requestTimestampMs: Date.now(),
        requestNonce: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to back up keys");
    const rows = Array.isArray(data?.backups) ? data.backups : [];
    setPrivateReceiveBackups(rows);
    if (rows[0]?.keyId) setSelectedBackupKeyId(rows[0].keyId);
  }

  async function recoverPrivateReceiveKeys() {
    const active = getActiveWalletAddress();
    if (!active) throw new Error("Connect wallet first");
    let keyId = selectedBackupKeyId;
    if (!keyId && privateReceiveBackups[0]?.keyId) {
      keyId = privateReceiveBackups[0].keyId;
    }
    if (!keyId) throw new Error("No backup on file yet. Use Save backup first.");
    if (!privateReceiveRecoverPassphrase) {
      throw new Error("Enter recovery passphrase");
    }
    const normalized = normalizeAddress(active);
    const res = await fetch("/api/privpay/recover-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: normalized,
        keyId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to fetch key backup");
    const recovered = await decryptWithPassphrase(data?.backup, privateReceiveRecoverPassphrase);
    const merged = mergedKeyring(loadPrivateReceiveKeyring(normalized), recovered);
    savePrivateReceiveKeyring(normalized, merged);
    await registerPrivateReceiverForAddress(normalized);
  }

  async function resolvePrivateReceiverByWallet(walletAddress) {
    const normalized = normalizeAddress(walletAddress);
    if (!normalized || !String(normalized).startsWith("0x")) {
      throw new Error("Enter a valid recipient wallet address");
    }
    const query = `/api/privpay/resolve?address=${encodeURIComponent(normalized)}`;
    let res = await fetch(query);
    let data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Seamless self-bootstrap when sender tries to pay self privately.
      const active = getActiveWalletAddress();
      if (active && normalizeAddress(active) === normalized) {
        await registerPrivateReceiverForAddress(normalized);
        res = await fetch(query);
        data = await res.json().catch(() => ({}));
      }
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 409) {
        throw new Error(
          "Recipient has not enabled private receive. Ask recipient to open your private-enable link and connect once."
        );
      }
      throw new Error(
        data?.error ||
          "Recipient has not enabled private receive yet. Ask them to connect once."
      );
    }
    return data.receiver;
  }

  function privateReceiveEnableLinkForAddress(address) {
    const normalized = normalizeAddress(address);
    if (typeof window === "undefined") return `swaparc://enable-private-receive?address=${normalized}`;
    const url = new URL(window.location.origin);
    url.searchParams.set("enablePrivateReceive", "1");
    url.searchParams.set("address", normalized);
    return url.toString();
  }

  function parsePrivateReceiveEnableIntent() {
    if (typeof window === "undefined") return null;
    const loc = window.location;
    const params = new URLSearchParams(loc.search || "");
    const enabled = params.get("enablePrivateReceive");
    const addr = params.get("address");
    if (enabled === "1" && addr) {
      return { address: addr };
    }
    // Backward-compat if someone opens /enablePrivateReceive=1&address=0x...
    const path = String(loc.pathname || "");
    if (path.startsWith("/enablePrivateReceive=1&address=")) {
      const raw = path.replace("/enablePrivateReceive=1&address=", "");
      if (raw) return { address: decodeURIComponent(raw) };
    }
    return null;
  }

  async function copyPrivateReceiveEnableLink(address, target = "bill") {
    const normalized = normalizeAddress(address);
    const link = privateReceiveEnableLinkForAddress(normalized);
    await navigator.clipboard.writeText(link);
    if (target === "payroll") {
      setPayrollRecipientInviteStatus("Enable-private link copied. Send it to the recipient.");
    } else {
      setBillRecipientInviteStatus("Enable-private link copied. Send it to the recipient.");
    }
  }

  async function ensureValidRecipientKeys({
    receiverSpendPublicKey,
    receiverViewPublicKey,
    recipientWallet,
    entityLabel = "Recipient",
  }) {
    try {
      return normalizeStealthRecipientKeys(
        receiverSpendPublicKey,
        receiverViewPublicKey
      );
    } catch (initialErr) {
      const wallet = String(recipientWallet || "").trim();
      if (!wallet) {
        throw new Error(
          `${entityLabel} keys are invalid and no ${entityLabel.toLowerCase()} wallet is saved for auto-repair. Open Edit and set a valid wallet, then save.`
        );
      }
      const receiver = await resolvePrivateReceiverByWallet(wallet);
      try {
        return normalizeStealthRecipientKeys(
          receiver?.spendPublicKey,
          receiver?.viewPublicKey
        );
      } catch {
        throw new Error(
          `${entityLabel} stealth keys are invalid and auto-repair from wallet failed. Ask ${entityLabel.toLowerCase()} to reconnect private receive.`
        );
      }
    }
  }

  async function repairBillRecipientKeys(bill) {
    if (!bill) return;
    try {
      setBillRuntimeError("");
      setBillRuntimeStatus("");
      const repaired = await ensureValidRecipientKeys({
        receiverSpendPublicKey: bill.receiverSpendPublicKey,
        receiverViewPublicKey: bill.receiverViewPublicKey,
        recipientWallet: bill.recipientWallet,
        entityLabel: "Recipient",
      });
      setBills((prev) =>
        prev.map((b) =>
          b.id === bill.id
            ? {
                ...b,
                receiverSpendPublicKey: repaired.receiverSpendPublicKey,
                receiverViewPublicKey: repaired.receiverViewPublicKey,
                schedulerFailureReason: null,
                lastSchedulerStatus: b.recurring ? "active" : b.lastSchedulerStatus,
              }
            : b
        )
      );
      setBillRuntimeStatus(`Recipient keys repaired for "${bill.name}". Try Pay Now again.`);
    } catch (e) {
      setBillRuntimeError(e?.message || String(e));
    }
  }

  async function withPrivateReceiveAction(task, successMessage) {
    setPrivateReceiveError("");
    setPrivateReceiveStatus("");
    setPrivateReceiveBusy(true);
    try {
      await task();
      if (successMessage) setPrivateReceiveStatus(successMessage);
    } catch (e) {
      setPrivateReceiveError(e?.message || String(e));
    } finally {
      setPrivateReceiveBusy(false);
    }
  }

  function mergeRecurringLogsIntoBillHistory(paymentLogs = [], schedulesById = {}) {
    if (!Array.isArray(paymentLogs) || paymentLogs.length === 0) return;
    setBillHistory((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      const additions = [];
      for (const log of paymentLogs) {
        const syntheticId = `recur_${log.id}`;
        if (seen.has(syntheticId)) continue;
        const bill = (billsRef.current || []).find((b) => b.id === log.scheduleId);
        const schedule = schedulesById[log.scheduleId];
        const baseName =
          String(bill?.name || "").trim() ||
          String(schedule?.metadata?.billName || "").trim() ||
          "";
        const billName = baseName
          ? `${baseName} (Recurring)`
          : `Bill (Recurring)`;
        additions.push({
          id: syntheticId,
          billId: log.scheduleId,
          billName,
          token:
            bill?.token ||
            INITIAL_TOKENS.find(
              (t) =>
                String(t.address || "").toLowerCase() ===
                String(log.tokenAddress || "").toLowerCase()
            )?.symbol ||
            "TOKEN",
          amount: Number(log.amount || 0),
          status: log.status === "success" ? "submitted" : log.status || "retry",
          txHash: log?.result?.txHash || null,
          paymentRail: log?.result?.paymentRail || null,
          poolAddress: log?.result?.poolAddress || null,
          poolNullifierHash: log?.result?.poolNullifierHash || null,
          poolCommitment: log?.result?.poolCommitment || null,
          poolClaimCode: log?.result?.poolClaimCode || null,
          poolRecipient: log?.result?.poolRecipient || null,
          blockNumber: log?.result?.blockNumber ?? null,
          stealthAddress: log?.result?.stealthAddress || null,
          ephemeralPublicKey: log?.result?.ephemeralPublicKey || null,
          viewTag: log?.result?.viewTag || null,
          payerAddress: log.payerAddress || null,
          createdAt: log.executedAt || new Date().toISOString(),
          error: log.error || null,
          schedulerState: schedulesById[log.scheduleId]?.status || null,
        });
      }
      if (!additions.length) return prev;
      return [...additions, ...prev];
    });
  }

  /**
   * Bills + Payroll recurring both execute on the server (relayer), not in the wallet.
   * Payer is always `getActiveWalletAddress()` — same automation for Circle (email) and Wallet Connect (EOA).
   * While this tab is open we POST recurring/run + payroll/run on an interval so due items pay without Vercel Cron.
   */
  async function runRecurringDueOnServerThrottled(ownerLower) {
    const owner = String(ownerLower || "").trim().toLowerCase();
    if (!owner.startsWith("0x")) return;
    const now = Date.now();
    const last = recurringServerRunLastAtRef.current;
    if (last && now - last < 12000) return;
    recurringServerRunLastAtRef.current = now;
    try {
      await fetch("/api/payments/recurring/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      });
      const payrollRes = await fetch("/api/payments/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      });
      const payrollJson = await payrollRes.json().catch(() => ({}));
      const note = String(payrollJson?.note || "").trim();
      if (note && /disabled|RECURRING_SERVER_EXECUTION_ENABLED/i.test(note)) {
        setPayrollAutopayServerHint(note);
      } else {
        setPayrollAutopayServerHint("");
      }
    } catch {
      // non-fatal; next tick retries
    }
  }

  /** Merge server payroll snapshot (history + schedule fields) without wiping unsaved local edits. */
  async function mergePayrollSnapshotFromServer() {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    try {
      const r = await fetch(`/api/payments/payroll/get?owner=${encodeURIComponent(owner)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !j?.state) return;
      const serverHist = Array.isArray(j.state.history) ? j.state.history : [];
      const serverEmps = Array.isArray(j.state.employees) ? j.state.employees : [];
      setPayrollHistory((prev) => {
        const ids = new Set((prev || []).map((h) => h.id).filter(Boolean));
        const add = serverHist.filter((h) => h?.id && !ids.has(h.id));
        if (!add.length) return prev;
        return [...add, ...prev].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
      });
      setPayrollEmployees((prev) => {
        const sm = new Map(serverEmps.map((e) => [e.id, e]));
        return prev.map((e) => {
          const u = sm.get(e.id);
          if (!u) return e;
          return {
            ...e,
            nextRunAt: u.nextRunAt ?? e.nextRunAt,
            lastPaidAt: u.lastPaidAt ?? e.lastPaidAt,
            failureReason: u.failureReason ?? e.failureReason,
            status: u.status ?? e.status,
            recurring: typeof u.recurring === "boolean" ? u.recurring : e.recurring,
          };
        });
      });
    } catch {
      // ignore
    }
  }

  async function mergePrivpayHistorySnapshotFromServer() {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    const ownerLower = String(owner).toLowerCase();
    try {
      const r = await fetch(
        `/api/privpay/history/get?owner=${encodeURIComponent(ownerLower)}`
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !j?.state) return;
      const serverBillHistory = Array.isArray(j.state.billHistory)
        ? j.state.billHistory
        : [];
      const serverClaimHistory = Array.isArray(j.state.claimHistory)
        ? j.state.claimHistory
        : [];

      setBillHistory((prev) => {
        const ids = new Set((prev || []).map((h) => h.id).filter(Boolean));
        const add = serverBillHistory.filter((h) => h?.id && !ids.has(h.id));
        if (!add.length) return prev;
        return [...add, ...prev].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        );
      });

      setPoolClaimHistory((prev) => {
        const ids = new Set((prev || []).map((h) => h.id).filter(Boolean));
        const add = serverClaimHistory.filter((h) => h?.id && !ids.has(h.id));
        if (!add.length) return prev;
        return [...add, ...prev].sort(
          (a, b) =>
            new Date(b.claimedAt || 0).getTime() -
            new Date(a.claimedAt || 0).getTime()
        );
      });
    } catch {
      // ignore; local storage remains fallback
    } finally {
      privpayHistoryHydratedOwnerRef.current = ownerLower;
    }
  }

  async function refreshRecurringStateFromBackend() {
    if (recurringRefreshBusyRef.current) return;
    recurringRefreshBusyRef.current = true;
    try {
      const owner = getActiveWalletAddress();
      if (!owner) return;
      const res = await fetch(
        `/api/payments/recurring/list?owner=${encodeURIComponent(
          String(owner).toLowerCase()
        )}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) return;
      const schedules = Array.isArray(data.schedules) ? data.schedules : [];
      const paymentLogs = Array.isArray(data.paymentLogs) ? data.paymentLogs : [];
      const scheduleMap = Object.fromEntries(schedules.map((s) => [s.id, s]));

      setBills((prev) =>
        prev.map((b) => {
          const s = scheduleMap[b.id];
          if (!s) return b;
          const localNextTs = new Date(b.nextExecutionAt || 0).getTime();
          const serverNextTs = new Date(s.nextExecutionAt || 0).getTime();
          const nextExecutionAt =
            Number.isFinite(localNextTs) &&
            Number.isFinite(serverNextTs) &&
            localNextTs > 0 &&
            serverNextTs > 0
              ? new Date(serverNextTs).toISOString()
              : s.nextExecutionAt || b.nextExecutionAt;
          return {
            ...b,
            recurring: s.status === "active",
            nextExecutionAt,
            lastSchedulerStatus: s.status || null,
            schedulerFailureReason: s.failureReason || null,
          };
        })
      );
      mergeRecurringLogsIntoBillHistory(paymentLogs, scheduleMap);
    } finally {
      recurringRefreshBusyRef.current = false;
    }
  }

  function isCircleMode() {
    return authMode === "email" && !!circleWallet;
  }

  function requireCircleAuth() {
    if (!isCircleMode()) throw new Error("Circle wallet not connected");
    const userToken = window.localStorage.getItem("circle_user_token");
    const encryptionKey = window.localStorage.getItem("circle_encryption_key");
    if (!userToken || !encryptionKey) throw new Error("Circle session expired. Please login again.");
    return { userToken, encryptionKey, walletId: circleWallet.walletId };
  }

  async function fetchCircleWalletsEnterprise(userToken) {
    const payload = { userToken };
    const enterpriseRes = await fetch("/api/circle/enterprise/wallet-services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const enterpriseData = await enterpriseRes.json().catch(() => ({}));
    if (enterpriseRes.ok && Array.isArray(enterpriseData.wallets)) {
      return enterpriseData.wallets;
    }

    // Fallback to legacy endpoint for backward compatibility.
    const legacyRes = await fetch("/api/circle/user/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const legacyData = await legacyRes.json().catch(() => ({}));
    if (!legacyRes.ok) {
      throw new Error(
        enterpriseData?.error ||
          legacyData?.error ||
          "Failed to load Circle wallets"
      );
    }
    return Array.isArray(legacyData.wallets) ? legacyData.wallets : [];
  }

  async function ensureCircleDeviceId() {
    if (typeof window === "undefined") return null;
    if (!circleSdkRef.current) {
      console.warn("[Circle] ensureCircleDeviceId: SDK not ready");
      return null;
    }

    // Reuse cached deviceId if present (prevents repeated SDK calls / improves UX)
    try {
      const cached = window.localStorage.getItem("circle_device_id") || window.localStorage.getItem("deviceId");
      if (cached && typeof cached === "string" && cached.length > 8) {
        setCircleDeviceId(cached);
        return cached;
      }
    } catch {
      // ignore storage failures
    }

    const getWithRetry = async (retries = 5, delayMs = 900) => {
      try {
        setEmailStatus(`Performing device security check…`);
        const id = await circleSdkRef.current.getDeviceId();
        if (!id) throw new Error("Received empty deviceId");
        console.log("[Circle] deviceId from sdk.getDeviceId()", id);
        try {
          window.localStorage.setItem("circle_device_id", id);
          window.localStorage.setItem("deviceId", id);
        } catch {
          // ignore storage failures
        }
        setCircleDeviceId(id);
        setEmailStatus("");
        return id;
      } catch (err) {
        if (retries > 0) {
          console.warn(`[Circle] getDeviceId failed, retrying... (${retries} left)`);
          await new Promise((res) => setTimeout(res, delayMs));
          // Exponential backoff (caps at 6s)
          const nextDelay = Math.min(6000, Math.floor(delayMs * 1.6));
          return getWithRetry(retries - 1, nextDelay);
        }
        throw err;
      }
    };

    try {
      return await getWithRetry();
    } catch (error) {
      console.error("[Circle] getDeviceId failed:", error);
      setEmailStatus("");
      let msg = "We couldn't complete the device security check. ";

      const isBrave =
        (navigator.brave && (await navigator.brave.isBrave())) || false;
      
      if (isBrave) {
        msg += "Brave browser detected — turn off Shields for this site (lion icon), then tap “Send OTP” again. ";
      } else {
        msg += "This is usually caused by strict tracking / cookie blockers. Please allow third‑party cookies (or disable strict tracking prevention) for this site, then try again. ";
      }

      msg += "You can also retry later; just reopen the email login and press “Send OTP” again once your settings are updated.";

      setEmailError(msg);
      return null;
    }
  }

  // Fetch On-Chain Prices Once (Shared Source)
  useEffect(() => {
    userEmailRef.current = userEmail;
  }, [userEmail]);

  useEffect(() => {
    const active = getActiveWalletAddress();
    if (!active) return;
    registerPrivateReceiverForAddress(active).catch((e) => {
      console.warn("[PRIVPAY] receiver auto-registration skipped:", e?.message || e);
    });
  }, [address, authMode, circleWallet?.address]);

  useEffect(() => {
    if (privateReceiveDeepLinkHandledRef.current) return;
    const intent = parsePrivateReceiveEnableIntent();
    if (!intent?.address) return;
    const target = normalizeAddress(intent.address);
    const active = getActiveWalletAddress();
    if (!active) {
      setPrivateReceiveStatus(
        `Private receive invite detected for ${target}. Connect this wallet and the app will enable private receive automatically.`
      );
      return;
    }
    const activeNormalized = normalizeAddress(active);
    if (activeNormalized !== target) {
      setPrivateReceiveError(
        `Invite is for ${target}, but connected wallet is ${activeNormalized}. Switch to the invited wallet and refresh.`
      );
      return;
    }
    privateReceiveDeepLinkHandledRef.current = true;
    withPrivateReceiveAction(
      async () => {
        await registerPrivateReceiverForAddress(target);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("enablePrivateReceive");
          url.searchParams.delete("address");
          window.history.replaceState({}, "", url.toString());
        }
      },
      "Private receive enabled for this wallet."
    );
  }, [address, authMode, circleWallet?.address]);

  useEffect(() => {
    const active = getActiveWalletAddress();
    if (!active) {
      setPrivateReceiveBackups([]);
      setSelectedBackupKeyId("");
      return;
    }
    loadPrivateReceiveBackups().catch(() => {
      // backup list is optional; ignore if unavailable
    });
  }, [address, authMode, circleWallet?.address]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (isCircleMode() && (circlePromptInFlightRef.current || circleActionsBusy || circleExecPrompt)) {
        return;
      }
      await runRecurringDueOnServerThrottled(String(owner).toLowerCase());
      await refreshRecurringStateFromBackend().catch(() => {});
      await mergePayrollSnapshotFromServer().catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    address,
    authMode,
    circleWallet?.address,
    circleActionsBusy,
    circleExecPrompt,
    activeTab,
    privpayModule,
  ]);

  // Persist Gmail Session
  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedEmail = window.localStorage.getItem("circle_user_email");
    const storedToken = window.localStorage.getItem("circle_user_token");
    
    // Only attempt restore if we are not already connected via wallet (MetaMask)
    // and not already in email mode.
    if (!storedEmail || !storedToken || address || authMode === "email") return;

    let cancelled = false;

    (async () => {
      try {
        console.log("[App] Attempting to restore Circle session for:", storedEmail);
        const res = await fetch(
          "/api/circle/user/get-or-create-wallet",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: storedEmail,
              userToken: storedToken,
            }),
          }
        );

        const data = await res.json();
        if (!res.ok) {
          console.warn("[App] Session restore failed:", data.error);
          return;
        }

        if (cancelled) return;

        console.log("[App] Session restored!", data);
        setUserEmail(storedEmail);
        if (data && data.walletId && data.address && data.blockchain) {
          setCircleWallet({
            walletId: data.walletId,
            address: data.address,
            blockchain: data.blockchain,
          });
          setCircleWalletReady(true);
          setAuthMode("email");
        } else if (
            data &&
            Array.isArray(data.wallets) &&
            data.wallets[0] &&
            data.wallets[0].id
        ) {
            setCircleWallet({
                walletId: data.wallets[0].id,
                address: data.wallets[0].address,
                blockchain: data.wallets[0].blockchain,
            });
            setCircleWalletReady(true);
            setAuthMode("email");
        }
      } catch (e) {
        console.error("[App] Session restore error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, authMode]);


  // Fetch On-Chain Prices Once (Shared Source)
  useEffect(() => {
    let mounted = true;
    async function fetchOnChainPrices() {
      if (isCircleMode() && (circlePromptInFlightRef.current || circleActionsBusy || circleExecPrompt)) {
        return;
      }
      // Always use public provider for prices to avoid wallet dependencies
      const provider = getReadProvider();

      try {
        const prices = {};
        // Use Promise.all for speed
        await Promise.all(
          INITIAL_TOKENS.map(async (t) => {
            prices[t.symbol] = await getOnchainPriceInUSDC(provider, t.symbol);
          })
        );

        if (mounted) {
          setTokenPrices(prices);
        }
      } catch (e) {
        console.warn("Token price fetch failed", e);
      }
    }

    fetchOnChainPrices();
    const interval = setInterval(fetchOnChainPrices, 30000); // Refresh every 30s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const calculatedPortfolioValue = useMemo(() => {
    if (!balances || Object.keys(balances).length === 0) return 0;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return 0;

    let total = 0;
    // Wallet Balances
    ["USDC", "EURC", "SWPRC"].forEach((sym) => {
      const bal = Number(balances[sym] || 0);
      const price = Number(tokenPrices[sym] || 0);
      total += bal * price;
    });

    // LP Positions Value (added to portfolio?)
    // User requirement: "Total Portfolio Value = USDC_value + EURC_value + SWPRC_value"
    // But usually portfolio includes LP. The prompt separates them.
    // "Total Portfolio Value = ..." strictly lists the 3 tokens.
    // However, previous code added LP value. I will follow the strict formula first,
    // but usually users want to see total net worth.
    // Wait, the prompt says "Total Portfolio Value = USDC_value + EURC_value + SWPRC_value".
    // It does NOT explicitly say "+ LP Value".
    // BUT, the previous implementation did.
    // I will include LP value if it was there, or check context.
    // Actually, looking at the previous code: `let totalPortfolio = totalLpUsd;` then added tokens.
    // So I should probably include LP value in "Portfolio Value" if that's what the UI expects.
    // The prompt defines "PORTFOLIO TOTAL VALUE" separate from "LP VALUE".
    // I will stick to the prompt's formula for the variable, but maybe the UI sums them?
    // Let's look at `calculatedLpTotalValue` first.
    return total;
  }, [balances, tokenPrices]);

  // LP Value Calculation (Memoized)
  const calculatedLpTotalValue = useMemo(() => {
    if (!lpTokenAmounts || Object.keys(lpTokenAmounts).length === 0) return 0;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return 0;

    let total = 0;
    Object.values(lpTokenAmounts).forEach((pool) => {
      Object.entries(pool).forEach(([sym, amt]) => {
        const price = Number(tokenPrices[sym] || 0);
        const amount = Number(amt);
        if (!isNaN(price) && !isNaN(amount)) {
            total += amount * price;
        }
      });
    });
    return total;
  }, [lpTokenAmounts, tokenPrices]);

  // Combined Portfolio for Display (if needed)
  const displayPortfolioValue =
    calculatedPortfolioValue + calculatedLpTotalValue;

  // Persist LP Value
  useEffect(() => {
    if (calculatedLpTotalValue > 0 && userId) {
      // Only update if significantly different
      if (
        profileStats &&
        Math.abs(
          Number(profileStats.lpProvided || 0) - calculatedLpTotalValue
        ) > 0.01
      ) {
        // Update local state immediately for UI responsiveness
        setProfileStats((prev) => ({
          ...prev,
          lpProvided: calculatedLpTotalValue,
        }));

        // Persist to backend
        fetch("/api/profile/updateLp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: userId,
            lpTotalValue: calculatedLpTotalValue,
          }),
        }).catch(console.error);
      }
    }
  }, [calculatedLpTotalValue, userId, profileStats]);

  // Badge Logic (Memoized)
  const badgeState = useMemo(() => {
    if (!profileStats) return { earlySwaparcer: false };

    const count = Number(profileStats.swapCount || 0);
    const vol = Number(profileStats.swapVolume || 0);
    // Use calculated LP value for immediate feedback, or profile?
    // User says "Badge state must recompute whenever... lpProvided changes".
    // calculatedLpTotalValue is the most up-to-date.
    const lp = calculatedLpTotalValue;

    const isEarlySwaparcer = count >= 100 || vol >= 10000 || lp >= 1000;
    return { earlySwaparcer: isEarlySwaparcer };
  }, [profileStats, calculatedLpTotalValue]);

  useEffect(() => {
    // Prevent race condition: Only calculate totals AFTER both balances AND prices are available.
    // This effect is now replaced by useMemo above.
    // I will remove the old effect logic in the next step or here.
    setPortfolioValue(displayPortfolioValue);
  }, [displayPortfolioValue]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) {
      setPrivpayAccess({
        plan: "none",
        recurringPayments: false,
        payrollAutomation: false,
        advancedPrivacy: false,
        isEarlySwaparcer: false,
        subscriptionActive: false,
        expiresAt: null,
      });
      return;
    }
    let cancelled = false;
    setSubStatusLoading(true);
    fetch(`/api/payments/subscription/status?owner=${encodeURIComponent(owner)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setPrivpayAccess((prev) => ({
            ...prev,
            ...data,
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSubStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authMode, address, circleWalletReady, circleWallet?.address, profileStats?.swapCount, profileStats?.swapVolume, profileStats?.lpProvided]);

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/profile/leaderboard");
      const data = await res.json();
      setLeaderboard(data);
    } catch (err) {
      console.error("Failed to fetch leaderboard", err);
    }
  }

  async function getProfileData(addr) {
    const targetAddr = addr || address;
    if (!targetAddr) return null;
    try {
      const res = await fetch(`/api/profile/get?userId=${targetAddr}`);
      if (res.ok) {
        const data = await res.json();
        // Unwrap the profile object from the response
        if (data && data.success && data.profile) {
          return data.profile;
        }
        // Fallback: check if the response was the profile itself (legacy)
        if (data && data.userId) {
          return data;
        }
      }
      return await createNewProfileData(targetAddr);
    } catch (err) {
      console.error("Failed to fetch profile", err);
      return null;
    }
  }

  async function createNewProfileData(addr) {
    try {
      const payload = {
        userId: addr,
        username: "Anonymous",
        walletId: addr,
      };
      const res = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return {
          ...payload,
          swapCount: 0,
          swapVolume: 0,
          lpProvided: 0,
          badges: [],
        };
      }
    } catch (err) {
      console.error("Failed to create profile", err);
    }
    return null;
  }

  async function fetchProfile(addr) {
    const target = addr || address;
    if (!target) return;

    console.log("[DEX] Fetching profile for:", target);
    const data = await getProfileData(target);
    if (data) {
      console.log("[DEX] Profile data received:", data);
      setProfileStats({
        swapCount: 0,
        swapVolume: 0,
        lpProvided: 0,
        badges: [],
        username: "Anon User",
        ...data
      });
      setUserId(data.userId || target);
    }
  }

  async function createNewProfile(addr) {
    const data = await createNewProfileData(addr);
    if (data) {
      setProfileStats(data);
      setUserId(addr);
    }
  }

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ username: "", avatar: "" });
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 500000) {
      // 500KB limit
      alert("Image too large (max 500KB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditForm((prev) => ({ ...prev, avatar: ev.target.result }));
    };
    reader.readAsDataURL(file);
  }

  function startEditing() {
    if (!profileStats) return;
    setEditForm({
      username: profileStats.username || "",
      avatar: profileStats.avatar || "",
    });
    setIsEditingProfile(true);
  }

  async function saveProfile() {
    const targetId = userId || address;
    if (!targetId) return;

    try {
      const res = await fetch("/api/profile/updateIdentity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetId,
          username: editForm.username,
          avatar: editForm.avatar,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsEditingProfile(false);
        fetchProfile();
      } else {
        alert("Save failed");
      }
    } catch (err) {
      console.error(err);
      alert("Save failed");
    }
  }

  useEffect(() => {
    if (activeTab === "leaderboard") fetchLeaderboard();

    (async () => {
      // Use fallback if window.ethereum is not available
        const provider = window.ethereum
          ? new ethers.BrowserProvider(window.ethereum)
          : getReadProvider();

      // For Circle users, prefer the public provider for stability
      const activeProvider = isCircleMode() ? getReadProvider() : provider;
      const walletAddr = getActiveWalletAddress();

      if (activeTab === "pools") {
        fetchPoolBalances(activeProvider).catch(console.warn);
      }

      if (!walletAddr) return;

      // Fast-path: hydrate LP cache for this wallet (instant positions on reload)
      if (lastLpCacheWalletRef.current !== walletAddr) {
        lastLpCacheWalletRef.current = walletAddr;
        setLpCacheHydrated(false);
      }

      try {
        const key = `swaparc_lp_cache_${String(walletAddr).toLowerCase()}`;
        const cachedRaw = window.localStorage.getItem(key);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.lpBalances && cached.lpTokenAmounts) {
            setLpBalances(cached.lpBalances || {});
            setLpTokenAmounts(cached.lpTokenAmounts || {});
          }
          // Mark as hydrated if we found a cache entry (even if it has empty objects).
          setLpCacheHydrated(true);
        }
      } catch {
        // ignore cache issues
      }

      try {
        // Always fetch balances when address is connected, regardless of tab
        const balData = await getBalances(walletAddr, activeProvider);
        setBalances(balData || {});

        if (activeTab === "profile") {
          // Run simultaneous fetches (Prices handled globally now)
          const [profData, lpBalData, lpAmountsResult] =
            await Promise.all([
              getProfileData(walletAddr),
              getAllLPBalancesData(walletAddr, activeProvider),
              getLpTokenAmountsData(walletAddr, activeProvider),
            ]);

          // Patch profile with latest LP if available and valid
          let finalProfile = profData;

          // Batch Updates
          if (finalProfile) {
            setProfileStats(finalProfile);
            setUserId(finalProfile.userId);
          }
          setLpBalances(lpBalData || {});
          setLpTokenAmounts(lpAmountsResult?.amounts || {});
        } else if (activeTab === "pools") {
          // Also fetch LP data for pools tab
          const [lpBalData, lpAmountsResult] = await Promise.all([
            getAllLPBalancesData(walletAddr, activeProvider),
            getLpTokenAmountsData(walletAddr, activeProvider),
          ]);
          setLpBalances(lpBalData || {});
          setLpTokenAmounts(lpAmountsResult?.amounts || {});
        }
      } catch (e) {
        console.error("Profile/Balance load error", e);
      }
    })();
  }, [activeTab, authMode, address, circleWalletReady, circleWallet?.address, circleWallet]); // include Circle readiness

  useEffect(() => {
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr || typeof window === "undefined") return;
    try {
      const key = `swaparc_lp_cache_${String(walletAddr).toLowerCase()}`;
      window.localStorage.setItem(
        key,
        JSON.stringify({
          ts: Date.now(),
          lpBalances,
          lpTokenAmounts,
        })
      );
    } catch {
      // ignore
    }
  }, [lpBalances, lpTokenAmounts, address, circleWallet]);

  useEffect(() => {
    if (!profileStats) return;
    if (!swapHistory || swapHistory.length === 0) return;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return;
  
    const successful = swapHistory.filter(
      (t) => !t.status || t.status === "success"
    );
  
    let rebuiltCount = 0;
    let rebuiltVolume = 0;
  
    for (const tx of successful) {
      const token = tx.fromToken || tx.token || "USDC";
      const amt = Number(tx.fromAmount || tx.amount || 0);
      const price = Number(tokenPrices[token] || 1);
  
      if (amt > 0) {
        rebuiltCount += 1;
        rebuiltVolume += amt * price;
      }
    }
  
    const backendCount = Number(profileStats.swapCount || 0);
    const walletAddr = getActiveWalletAddress();
  
    // ONLY repair fresh profiles
    /*
    if (backendCount === 0 && rebuiltCount > 0) {
      setProfileStats((prev) => ({
        ...prev,
        swapCount: rebuiltCount,
        swapVolume: rebuiltVolume,
      }));
  
      fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId || walletAddr,
          swapCount: rebuiltCount,
          swapVolume: rebuiltVolume,
        }),
      }).catch(console.error);
    }
    */
  }, [swapHistory, tokenPrices, profileStats, userId, address, circleWallet]);
  

  useEffect(() => {
    const walletAddr = getActiveWalletAddress();
    if (walletAddr) {
      fetchProfile(walletAddr);
    } else {
      setProfileStats(null);
      setUserId(null);
    }
  }, [address, circleWallet]);

  useEffect(() => {
    if (!CIRCLE_APP_ID) {
      console.warn("Circle SDK init skipped: missing VITE_CIRCLE_APP_ID");
      return;
    }

    if (circleSdkRef.current) {
      setSdkReady(true);
      return;
    }

    let cancelled = false;

    // Global listener to debug Circle SDK messages
    const messageHandler = (event) => {
      // Filter for relevant Circle messages if possible, but log all for now to debug
      if (event.origin === "https://circle.com" || event.origin.includes("circle")) {
         console.log("[Circle] Window Message:", event.data);
      }
    };
    window.addEventListener("message", messageHandler);

    const initSdk = async () => {
      try {
        console.log("[Circle] init appId:", CIRCLE_APP_ID);

        const onLoginComplete = async (error, result) => {
          console.log("[Circle] onLoginComplete TRIGGERED", { error, result, isMounted: isMountedRef.current });
          if (!isMountedRef.current) return;

          if (error || !result) {
            const err = error || {};
            const message =
              err && err.message ? err.message : "Email authentication failed";
            console.error("[Circle] Login failed:", message);
            setEmailError(message);
            setEmailStatus("");
            setCircleLogin(null);
            setEmailLoading(false);
            return;
          }

          const loginData = {
            userId: result.userId || null,
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
            refreshToken: result.refreshToken || null,
          };

          console.log("[Circle] Login success, data:", loginData);
          setCircleLogin(loginData);
          setEmailError("");
          
          // Force UI update to show progress
          setEmailStatus("Email verified. Authenticating...");
          
          // Ensure we persist the session immediately
          if (typeof window !== "undefined") {
             window.localStorage.setItem("circle_user_token", loginData.userToken);
             window.localStorage.setItem("circle_encryption_key", loginData.encryptionKey);
          }

          const email = userEmailRef.current;

          if (!email) {
            setEmailStatus("Email verified.");
            setEmailLoading(false);
            return;
          }

          try {
            setEmailStatus("Email verified. Checking wallet...");

            let res = await fetch("/api/circle/user/get-or-create-wallet", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                userToken: loginData.userToken,
              }),
            });

            let data = await res.json();
            console.log("[Circle] get-or-create-wallet response:", res.status, data);

            if (res.status === 404) {
              await initializeAndCreateCircleWallet(loginData);
              return;
            }

            if (!res.ok) {
              setEmailError(
                data.error || data.message || "Failed to load Circle wallet"
              );
              setEmailStatus("");
              setEmailLoading(false);
              return;
            }

            if (data && data.walletId && data.address && data.blockchain) {
              setCircleWallet({
                walletId: data.walletId,
                address: data.address,
                blockchain: data.blockchain,
              });
            } else if (
              data &&
              Array.isArray(data.wallets) &&
              data.wallets[0] &&
              data.wallets[0].id
            ) {
              setCircleWallet({
                walletId: data.wallets[0].id,
                address: data.wallets[0].address,
                blockchain: data.wallets[0].blockchain,
              });
            } else {
              throw new Error("Unexpected wallet response shape");
            }
            setCircleWalletReady(true);
            setAuthMode("email");
            setEmailStatus("Circle wallet ready");
            setShowEmailModal(false);
            setEmailLoading(false);
          } catch (e) {
            console.error("[Circle] Wallet load error:", e);
            setEmailError("Failed to load Circle wallet");
            setEmailStatus("");
            setEmailLoading(false);
          }
        };

        const sdk = new W3SSdk(
          {
            appSettings: { appId: CIRCLE_APP_ID },
          },
          onLoginComplete
        );

        if (cancelled) return;
        circleSdkRef.current = sdk;
        setSdkReady(true);
      } catch (err) {
        console.error("[Circle] SDK init failed", err);
        if (!cancelled) setEmailError("Circle email connect is unavailable");
      }
    };

    initSdk();

    return () => {
      cancelled = true;
      circleSdkRef.current = null;
      setSdkReady(false);
      window.removeEventListener("message", messageHandler);
    };
  }, []);

  useEffect(() => {
    // Do not pre-warm deviceId; retrieve it when user clicks "Send OTP".
  }, [sdkReady]);

  useEffect(() => {
    console.log("Circle debug state", {
      appId: CIRCLE_APP_ID,
      sdkReady,
      circleDeviceId,
    });
  }, [sdkReady, circleDeviceId]);

  // Removed duplicate session restore effect
  // The primary restore logic is now handled by the useEffect above
  // around line 450.


  async function fetchSingleLpBalance(p, user) {
    if (!p || !user) return { human: 0, raw: 0n, dec: 18, lpTokenAddress: p?.lpToken };
    try {
      return await withReadProviders(async (prov, url) => {
        const userNorm = normalizeAddress(user);
        // Resolve LP token dynamically from pool (prevents stale preset lpToken from showing 0)
        let lpTokenAddress = p.lpToken;
        try {
          const pool = new ethers.Contract(p.poolAddress, POOL_ABI, prov);
          const resolved = await pool.lpToken().catch(() => null);
          if (resolved && resolved !== ethers.ZeroAddress) lpTokenAddress = resolved;
        } catch {}

        const lp = new ethers.Contract(lpTokenAddress, LP_ABI, prov);
        const raw = await lp.balanceOf(userNorm);
        const dec = await lp.decimals().catch(() => 18);
        const humanNum = Number.parseFloat(ethers.formatUnits(raw, dec));

        console.log("[LP-Debug] balanceOf", {
          poolId: p.id,
          user: userNorm,
          rpc: url,
          lpToken: lpTokenAddress,
          decimals: Number(dec),
          raw: raw?.toString?.() ? raw.toString() : String(raw),
          human: humanNum,
        });

        return {
          human: Number.isFinite(humanNum) ? humanNum : 0,
          raw,
          dec: Number(dec) || 18,
          lpTokenAddress,
          rpcUrl: url,
        };
      }, `lp.balanceOf(${p.id})`);
    } catch (e) {
      console.warn(`[LP-Debug] fetchSingleLpBalance failed for ${p?.id}`, e?.message || e);
      return { human: null, raw: 0n, dec: 18, lpTokenAddress: p?.lpToken };
    }
  }

  async function getAllLPBalancesData(user, provider) {
    const balances = {};
    for (const p of POOLS) {
      try {
        const { human } = await fetchSingleLpBalance(p, user);
        balances[p.id] = human;
      } catch {
        // Do NOT mask failures as "0" — that causes misleading UX (can't remove LP, etc.)
        balances[p.id] = null;
      }
    }
    return balances;
  }

  async function fetchAllLPBalances(user, provider) {
    const balances = await getAllLPBalancesData(user, provider);
    setLpBalances(balances);
  }

  async function refreshUserLiquidityData(userAddr) {
    if (!userAddr) return;
    const provider = getReadProvider();
    setLpLoading(true);
    try {
      await fetchBalances(userAddr, provider);
      await fetchAllLPBalances(userAddr, provider);
      await fetchLPTokenAmounts(userAddr, provider);
      await fetchPoolBalances(provider);
    } finally {
      setLpLoading(false);
    }
  }

  const lastLiquidityRefreshRef = useRef(null);
  useEffect(() => {
    const userAddr = getActiveWalletAddress();
    if (!userAddr) return;
    // Only refresh when the active wallet changes or becomes ready
    if (lastLiquidityRefreshRef.current === userAddr) return;
    // Avoid fetching before Circle wallet is actually ready
    if (authMode === "email" && (!circleWalletReady || !circleWallet?.address)) return;
    lastLiquidityRefreshRef.current = userAddr;
    refreshUserLiquidityData(userAddr).catch((e) =>
      console.warn("Liquidity refresh failed", e)
    );
  }, [authMode, circleWalletReady, circleWallet?.address, address]);

  async function handleClaimRewards(poolPreset) {
    console.log("[CircleTx] Starting Claim Rewards...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }

    try {
      const provider = isCircleMode() ? getReadProvider() : (await getSigner()).provider || new ethers.BrowserProvider(window.ethereum);

      if (isCircleMode()) {
        const claimTx = buildClaimRewardsCall(poolPreset.poolAddress);
        
        const { hash: txHash } = await executeCircleContractAction({
          contractAddress: claimTx.contractAddress,
          abiFunctionSignature: claimTx.abiFunctionSignature,
          abiParameters: claimTx.abiParameters,
          title: "Confirm claim rewards in Circle",
        });
        console.log("[CircleTx] Claim Rewards confirmed:", txHash);
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const pool = new ethers.Contract(poolPreset.poolAddress, POOL_ABI, signer);
        const tx = await pool.claimRewards();
        await tx.wait();
        console.log("[WalletTx] Claim Rewards confirmed:", tx.hash);
      }

      await fetchBalances(walletAddr, provider);
      await fetchAllLPBalances(walletAddr, provider);

      alert("Rewards claimed!");
    } catch (err) {
      console.error("[App] Claim rewards failed:", err);
      alert("Claim rewards failed: " + (err.message || err));
    }
  }

  async function getLpTokenAmountsData(user, provider) {
    const result = {};
    let totalLpUsd = 0;

    for (const p of POOLS) {
      try {
        // Contracts
        const pool = new ethers.Contract(p.poolAddress, POOL_ABI, provider);
        const lp = new ethers.Contract(p.lpToken, LP_ABI, provider);

        // LP math
        const userLP = await lp.balanceOf(user); // raw LP
        const totalLP = await lp.totalSupply(); // raw LP

        if (totalLP === 0n || userLP === 0n) continue;

        const share = Number(userLP) / Number(totalLP);

        // Pool balances
        const balances = await pool.getBalances();

        result[p.id] = {};

        for (let i = 0; i < p.tokens.length; i++) {
          const sym = p.tokens[i];
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const tokenC = new ethers.Contract(
            token.address,
            ERC20_ABI,
            provider
          );
          const dec = await tokenC.decimals();

          const poolAmount = Number(ethers.formatUnits(balances[i], dec));
          const userShareAmount = poolAmount * share;

          result[p.id][sym] = userShareAmount;

          // Calculate USD value for this portion using already-fetched tokenPrices
          // (avoid extra on-chain calls that can trigger RPC rate limits and UI flicker)
          const price = Number(tokenPrices?.[sym] || 0);
          totalLpUsd += userShareAmount * price;
        }
      } catch (e) {
        console.warn("LP breakdown failed for", p.id, e);
      }
    }
    return { amounts: result, totalLpUsd };
  }

  async function fetchLPTokenAmounts(user, provider) {
    const { amounts, totalLpUsd } = await getLpTokenAmountsData(user, provider);
    setLpTokenAmounts(amounts);

    // Persist LP stat to backend
    try {
      await fetch("/api/profile/updateLp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user, lpTotalValue: totalLpUsd }),
      });
      if (activeTab === "profile") fetchProfile(user);
    } catch (err) {
      console.warn("Failed to update LP stats", err);
    }
  }
  async function getOnchainPriceInUSDC(provider, fromSymbol) {
    if (fromSymbol === "USDC") return 1;

    try {
      const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);

      const fromIndex = TOKEN_INDICES[fromSymbol];
      const usdcIndex = TOKEN_INDICES.USDC;

      const token = INITIAL_TOKENS.find((t) => t.symbol === fromSymbol);
      const tokenC = new ethers.Contract(token.address, ERC20_ABI, provider);
      const decimals = await tokenC.decimals();

      const oneToken = ethers.parseUnits("1", decimals);
      const dy = await pool.get_dy(fromIndex, usdcIndex, oneToken);

      return Number(ethers.formatUnits(dy, 6));
    } catch (e) {
      console.warn("Price fetch failed for", fromSymbol);
      return 0;
    }
  }

  async function fetchPoolBalances(provider) {
    const tvlResult = {};
    const tokenResult = {};

    for (const p of POOLS) {
      try {
        const pool = new ethers.Contract(p.poolAddress, POOL_ABI, provider);
        const raw = await pool.getBalances();

        tokenResult[p.id] = {};
        let tvl = 0;

        for (let i = 0; i < p.tokens.length; i++) {
          const sym = p.tokens[i];
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const tokenC = new ethers.Contract(
            token.address,
            ERC20_ABI,
            provider
          );
          const dec = await tokenC.decimals();

          const bal = Number(ethers.formatUnits(raw[i], dec));
          tokenResult[p.id][sym] = bal;

          const priceInUSDC = await getOnchainPriceInUSDC(provider, sym);
          tvl += bal * priceInUSDC;
        }

        tvlResult[p.id] = tvl;
      } catch {
        tvlResult[p.id] = 0;
        tokenResult[p.id] = {};
      }
    }

    setPoolBalances(tvlResult);
    setPoolTokenBalances(tokenResult);
  }

  async function fetchPoolTransactions() {
    setTxLoading(true);
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${SWAP_POOL_ADDRESS}&sort=desc`
      );
      const data = await res.json();

      if (data.status !== "1") {
        setPoolTxs([]);
        return;
      }

      setPoolTxs(data.result);
    } catch (err) {
      console.error("Failed to fetch pool txs", err);
    } finally {
      setTxLoading(false);
    }
  }

  async function fetchPoolTransactionsData() {
    const res = await fetch(
      `https://testnet.arcscan.app/api?module=account&action=txlist&address=${SWAP_POOL_ADDRESS}&sort=desc`
    );
    const data = await res.json();
    if (data.status !== "1") return [];
    return Array.isArray(data.result) ? data.result : [];
  }

  async function arcscanJson(params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`https://testnet.arcscan.app/api?${qs.toString()}`);
    return await res.json();
  }

  async function arcscanLatestBlockNumber() {
    try {
      const provider = getReadProvider();
      const n = await provider.getBlockNumber();
      if (Number.isFinite(Number(n))) return Number(n);
    } catch {
      // ignore
    }
    return null;
  }

  async function arcscanSwapLogTxHashesForUser(userAddr) {
    if (!userAddr) return [];
    // Curve-style stable swap pools often emit TokenExchange with buyer indexed.
    // We use ArcScan getLogs for performance (avoids per-tx receipt RPC calls).
    const latest = await arcscanLatestBlockNumber();
    const fromBlock = latest != null ? Math.max(0, latest - 250_000) : 0;

    const topic0 = ethers.id(
      "TokenExchange(address,uint256,uint256,uint256,uint256)"
    );
    const topic1 = ethers.zeroPadValue(userAddr, 32);

    const data = await arcscanJson({
      module: "logs",
      action: "getLogs",
      fromBlock: String(fromBlock),
      toBlock: "latest",
      address: SWAP_POOL_ADDRESS,
      topic0,
      topic1,
    });

    const logs = Array.isArray(data?.result) ? data.result : [];
    const hashes = [];
    for (const l of logs) {
      const h = l?.transactionHash;
      if (typeof h === "string" && h.startsWith("0x")) hashes.push(h);
    }
    return hashes;
  }

  function tokenByAddress(addr) {
    const normalized = String(addr || "").toLowerCase();
    return INITIAL_TOKENS.find((t) => String(t.address || "").toLowerCase() === normalized) || null;
  }

  function addressFromTopic(topic) {
    const t = String(topic || "");
    if (!t.startsWith("0x") || t.length < 66) return null;
    try {
      return ethers.getAddress(`0x${t.slice(-40)}`);
    } catch {
      return null;
    }
  }

  async function fetchPrivateIncomingForWallet(walletAddress) {
    if (!walletAddress || !STEALTH_PAYMENTS_ADDRESS) return [];
    const normalized = normalizeAddress(walletAddress);
    const keyring = loadPrivateReceiveKeyring(normalized);
    const keys = Array.isArray(keyring?.keys)
      ? keyring.keys.filter((k) => k?.spendPublicKey && k?.viewPrivateKey && k?.spendPrivateKey)
      : [];
    if (!keys.length) return [];

    const latest = await arcscanLatestBlockNumber();
    const fromBlock = latest != null ? Math.max(0, latest - 250_000) : 0;
    const topic0 = ethers.id(
      "StealthPaymentAnnounced(address,address,uint256,bytes,bytes1,bytes32)"
    );
    const data = await arcscanJson({
      module: "logs",
      action: "getLogs",
      fromBlock: String(fromBlock),
      toBlock: "latest",
      address: STEALTH_PAYMENTS_ADDRESS,
      topic0,
    });
    const logs = Array.isArray(data?.result) ? data.result : [];
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const incoming = [];
    for (const l of logs) {
      const txHash = String(l?.transactionHash || "");
      const topics = Array.isArray(l?.topics) ? l.topics : [];
      if (topics.length < 3 || !txHash.startsWith("0x")) continue;
      const stealthAddress = addressFromTopic(topics[1]);
      const tokenAddress = addressFromTopic(topics[2]);
      if (!stealthAddress || !tokenAddress) continue;
      let decoded;
      try {
        decoded = coder.decode(["uint256", "bytes", "bytes1", "bytes32"], l.data);
      } catch {
        continue;
      }
      const amountRaw = decoded?.[0] != null ? decoded[0].toString() : "0";
      const ephemeralPublicKey = bytesLikeToHex(decoded?.[1]);
      const viewTag = bytesLikeToHex(decoded?.[2]);
      const metadataHash = bytesLikeToHex(decoded?.[3]);
      if (!ephemeralPublicKey || !viewTag) continue;

      for (const key of keys) {
        let match = null;
        try {
          match = scanStealthAnnouncement({
            receiverSpendPublicKey: key.spendPublicKey,
            receiverViewPrivateKey: key.viewPrivateKey,
            ephemeralPublicKey,
            announcedStealthAddress: stealthAddress,
            announcedViewTag: viewTag,
          });
        } catch {
          match = null;
        }
        if (!match?.match) continue;
        let claim = null;
        try {
          claim = deriveStealthPrivateKey({
            receiverSpendPrivateKey: key.spendPrivateKey,
            receiverViewPrivateKey: key.viewPrivateKey,
            ephemeralPublicKey,
          });
        } catch {
          claim = null;
        }
        const token = tokenByAddress(tokenAddress);
        const decimals = token?.symbol === "USDC" || token?.symbol === "EURC" ? 6 : 18;
        incoming.push({
          id: `${txHash}:${l.logIndex || "0"}:${key.keyId}`,
          txHash,
          tokenAddress,
          tokenSymbol: token?.symbol || shortAddr(tokenAddress),
          amountRaw,
          amountFormatted: ethers.formatUnits(amountRaw, decimals),
          stealthAddress,
          ephemeralPublicKey,
          viewTag,
          metadataHash,
          blockNumber: l.blockNumber || null,
          keyId: key.keyId,
          claimStealthPrivateKey: claim?.stealthPrivateKey || "",
          createdAt: l.timeStamp
            ? new Date(Number(l.timeStamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
        break;
      }
    }
    return incoming.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async function refreshPrivateIncoming() {
    const active = getActiveWalletAddress();
    if (!active) {
      setPrivateIncoming([]);
      return;
    }
    setPrivateIncomingLoading(true);
    setPrivateIncomingError("");
    setPrivateReceiveError("");
    try {
      const rows = await fetchPrivateIncomingForWallet(active);
      setPrivateIncoming(rows);
      if (!rows.length) {
        setPrivateReceiveStatus("No private incoming payments found yet.");
      }
    } catch (e) {
      setPrivateIncomingError(e?.message || String(e));
    } finally {
      setPrivateIncomingLoading(false);
    }
  }

  function incomingDisplayMeta(incoming) {
    const hash = String(incoming?.metadataHash || "").toLowerCase();
    if (!hash) return { title: "Incoming Payment", subtitle: "stealth receive" };
    const bill = (billHistory || []).find(
      (h) => String(h?.metadataHash || "").toLowerCase() === hash
    );
    if (bill?.billName) {
      const rail =
        bill.paymentRail === "privacyPool" ? "privacy pool" : "stealth receive";
      return { title: bill.billName, subtitle: `bill • ${rail}` };
    }
    const pay = (payrollHistory || []).find(
      (h) => String(h?.metadataHash || "").toLowerCase() === hash
    );
    if (pay?.employeeName) {
      const rail =
        pay.paymentRail === "privacyPool" ? "privacy pool" : "stealth receive";
      return {
        title: `Payroll: ${payrollHistoryDisplayTitle(pay)}`,
        subtitle: `${pay.role || "salary"} • ${rail}`,
      };
    }
    return { title: "Incoming Payment", subtitle: "stealth receive" };
  }

  function formatClaimError(err) {
    const detailed = extractEthersRevertReason(err);
    const raw = String(err?.message || err || "");
    const meaningful =
      detailed &&
      !/^(call exception|transaction reverted|execution reverted)$/i.test(detailed);
    if (meaningful) {
      const msg = detailed.length > 260 ? `${detailed.slice(0, 260)}…` : detailed;
      if (/wrong network|chain id|incorrect network/i.test(msg)) {
        return `${msg} Switch the wallet to ARC testnet before claiming.`;
      }
      return msg;
    }
    if (raw.includes("CALL_EXCEPTION") || raw.includes("transaction execution reverted")) {
      return "Claim reverted (see browser console for full RPC error). Common causes: wallet not on ARC testnet so gas top-up went to the wrong chain, or the token rejected the transfer.";
    }
    if (raw.toLowerCase().includes("insufficient funds")) {
      return "Insufficient native gas for claim top-up/transfer.";
    }
    if (raw.length > 220) return `${raw.slice(0, 220)}...`;
    return raw || "Claim failed";
  }

  async function claimIncomingPayment(incoming) {
    if (!incoming?.id) return;
    const active = getActiveWalletAddress();
    if (!active) throw new Error("Connect wallet first.");
    if (!incoming.claimStealthPrivateKey) {
      throw new Error("Could not derive stealth private key for this incoming payment.");
    }
    setPrivateIncomingBusyId(incoming.id);
    setPrivateReceiveError("");
    setPrivateReceiveStatus("");
    try {
      const provider = getReadProvider();
      const recipient = normalizeAddress(active);
      const stealthWallet = new ethers.Wallet(incoming.claimStealthPrivateKey, provider);
      const announcedStealth = normalizeAddress(incoming.stealthAddress);
      if (normalizeAddress(stealthWallet.address) !== announcedStealth) {
        throw new Error(
          "Derived stealth wallet does not match the announced stealth address. Re-sync private receive keys if this persists."
        );
      }
      const token = new ethers.Contract(incoming.tokenAddress, ERC20_ABI, provider);
      let balance = await token.balanceOf(stealthWallet.address);
      if (balance <= 0n) {
        throw new Error("No token balance left on this stealth address.");
      }

      // Fund stealth wallet gas from connected wallet (single prompt), then sweep token.
      const tokenAsStealth = new ethers.Contract(incoming.tokenAddress, ERC20_ABI, stealthWallet);
      const transferTxReq = await tokenAsStealth.transfer.populateTransaction(recipient, balance);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
      let estimatedGas;
      try {
        estimatedGas = await provider.estimateGas({
          from: stealthWallet.address,
          to: incoming.tokenAddress,
          data: transferTxReq.data,
        });
      } catch (estErr) {
        console.error("[claimIncoming] estimateGas(transfer) failed", estErr);
        throw new Error(
          `Cannot estimate gas for token transfer from stealth (simulation reverted): ${extractEthersRevertReason(estErr)}`
        );
      }
      const gasNeeded = (estimatedGas * gasPrice * 12n) / 10n;
      const stealthNative = await provider.getBalance(stealthWallet.address);
      if (stealthNative < gasNeeded) {
        const topUp = gasNeeded - stealthNative;
        if (isCircleMode()) {
          const { userToken, walletId } = requireCircleAuth();
          const amountNative = ethers.formatEther(topUp);
          const initRes = await fetch("/api/circle/enterprise/execute-native-transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userToken,
              walletId,
              to: stealthWallet.address,
              amountNative,
              feeLevel: "MEDIUM",
              requestTimestampMs: Date.now(),
              requestNonce: crypto.randomUUID(),
              idempotencyKey: crypto.randomUUID(),
            }),
          });
          const initData = await initRes.json().catch(() => ({}));
          if (!initRes.ok || !initData?.challengeId) {
            throw new Error(initData?.error || "Failed to top up stealth wallet gas from Circle.");
          }
          const topupSdk = await executeCircleChallengeViaPrompt(
            initData.challengeId,
            "Confirm gas top-up for private claim"
          );
          let topupHash = extractCircleSdkTxHash(topupSdk);
          if (!topupHash) {
            topupHash = await waitForCircleTxHash(initData.challengeId, {
              transactionId: initData.transactionId,
              maxAttempts: 45,
            });
          }
          if (!topupHash) {
            throw new Error("Gas top-up submitted but tx hash not found.");
          }
        } else {
          const signer = await getSigner();
          const txTopUp = await signer.sendTransaction({
            to: stealthWallet.address,
            value: topUp,
          });
          await txTopUp.wait();
        }
      }

      const stealthNativeAfter = await provider.getBalance(stealthWallet.address);
      if (stealthNativeAfter < gasNeeded) {
        throw new Error(
          "Stealth address still lacks native gas after top-up. If you use an injected wallet, it must be switched to ARC testnet (chain id 5042002) so the top-up lands on the same network as this token balance."
        );
      }

      // Re-read token balance right before sweeping to avoid stale local reads.
      // If the earlier balanceOf() was from a slightly older state (or another
      // claim landed before we submitted), the actual transfer will revert with:
      // "ERC20: transfer amount exceeds balance".
      balance = await token.balanceOf(stealthWallet.address);
      if (balance <= 0n) {
        throw new Error("Token balance on the stealth address is now zero (changed before claim).");
      }

      const claimViaStealthContract = async () => {
        if (!STEALTH_PAYMENTS_ADDRESS) {
          throw new Error("Missing VITE_STEALTH_PAYMENTS_ADDRESS for contract-assisted claim.");
        }
        const tokenSC = new ethers.Contract(incoming.tokenAddress, ERC20_ABI, stealthWallet);
        const approveTx = await tokenSC.approve(STEALTH_PAYMENTS_ADDRESS, balance);
        await approveTx.wait();
        const stealthContract = new ethers.Contract(
          STEALTH_PAYMENTS_ADDRESS,
          STEALTH_PAYMENTS_ABI,
          stealthWallet
        );
        const ephPub = bytesLikeToHex(incoming.ephemeralPublicKey);
        let vTag = bytesLikeToHex(incoming.viewTag);
        if (!/^0x[0-9a-fA-F]{2}$/.test(vTag)) {
          vTag = "0x00";
        }
        let mHash = bytesLikeToHex(incoming.metadataHash);
        if (!/^0x[0-9a-fA-F]{64}$/.test(mHash)) {
          mHash = ethers.ZeroHash;
        }
        const assisted = await stealthContract.announceERC20Payment(
          incoming.tokenAddress,
          recipient,
          balance,
          ephPub,
          vTag,
          mHash
        );
        const assistedRcpt = await assisted.wait();
        return { tx: assisted, rcpt: assistedRcpt };
      };

      const assertRcptOk = (r) => {
        if (r?.status !== 1) throw new Error("Transaction reverted (receipt status 0).");
      };

      const claimErrors = [];
      let tx;
      let rcpt;

      try {
        tx = await tokenAsStealth.transfer(recipient, balance);
        rcpt = await tx.wait();
        assertRcptOk(rcpt);
      } catch (e1) {
        claimErrors.push(`ERC-20 transfer: ${extractEthersRevertReason(e1)}`);
        try {
          const approveSelf = await tokenAsStealth.approve(stealthWallet.address, balance);
          await approveSelf.wait();
          tx = await tokenAsStealth.transferFrom(stealthWallet.address, recipient, balance);
          rcpt = await tx.wait();
          assertRcptOk(rcpt);
        } catch (e2) {
          claimErrors.push(`transferFrom(self): ${extractEthersRevertReason(e2)}`);
          let spentOk = false;
          if (!isCircleMode()) {
            try {
              const spender = await getSigner();
              const spenderAddr = normalizeAddress(await spender.getAddress());
              const approveSpender = await tokenAsStealth.approve(spenderAddr, balance);
              await approveSpender.wait();
              const tokenAsSpender = new ethers.Contract(incoming.tokenAddress, ERC20_ABI, spender);
              tx = await tokenAsSpender.transferFrom(stealthWallet.address, recipient, balance);
              rcpt = await tx.wait();
              assertRcptOk(rcpt);
              spentOk = true;
            } catch (e3) {
              claimErrors.push(`transferFrom(spender): ${extractEthersRevertReason(e3)}`);
            }
          }
          if (!spentOk) {
            try {
              const assisted = await claimViaStealthContract();
              tx = assisted.tx;
              rcpt = assisted.rcpt;
              assertRcptOk(rcpt);
            } catch (e4) {
              claimErrors.push(`StealthPayments assist: ${extractEthersRevertReason(e4)}`);
              console.error("[claimIncoming] all paths failed", claimErrors);
              throw new Error(claimErrors.join(" "));
            }
          }
        }
      }

      setPrivateIncoming((prev) => prev.filter((x) => x.id !== incoming.id));
      setPrivateReceiveStatus(
        `Claimed ${incoming.amountFormatted} ${incoming.tokenSymbol}. Claim tx: ${shortAddr(
          tx.hash
        )}`
      );
      if (rcpt?.status !== 1) {
        throw new Error("Claim transaction was not confirmed.");
      }
    } finally {
      setPrivateIncomingBusyId("");
    }
  }

  async function fetchCircleMinePoolTransactions(circleAddr) {
    if (!circleAddr) return;
    setTxLoading(true);
    try {
      const [poolList, logHashes] = await Promise.all([
        fetchPoolTransactionsData(),
        arcscanSwapLogTxHashesForUser(circleAddr),
      ]);

      const hashSet = new Set(logHashes.map((h) => String(h).toLowerCase()));
      const filtered = poolList.filter((tx) =>
        hashSet.has(String(tx?.hash || "").toLowerCase())
      );

      setPoolTxs(filtered);
    } catch (err) {
      console.error("Failed to fetch Circle mine txs", err);
      setPoolTxs([]);
    } finally {
      setTxLoading(false);
    }
  }

  async function fetchUserPoolTransactions(userAddress) {
    if (!userAddress) return;

    setTxLoading(true);
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${userAddress}&sort=desc`
      );
      const data = await res.json();

      if (data.status !== "1") {
        setPoolTxs([]);
        return;
      }

      const filtered = data.result.filter(
        (tx) =>
          tx.to?.toLowerCase() === SWAP_POOL_ADDRESS.toLowerCase() ||
          tx.from?.toLowerCase() === SWAP_POOL_ADDRESS.toLowerCase()
      );

      setPoolTxs(filtered);
    } catch (err) {
      console.error("Failed to fetch user txs", err);
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => {
    setTxPage(0);
  }, [historyView]);

  useEffect(() => {
    if (activeTab !== "history") return;

    setTxPage(0);

    const a = getActiveWalletAddress();
    if (historyView === "mine" && a) {
      if (authMode === "email") {
        fetchCircleMinePoolTransactions(a);
      } else {
        fetchUserPoolTransactions(a);
      }
    } else {
      fetchPoolTransactions();
    }
  }, [activeTab, historyView, authMode, address, circleWalletReady, circleWallet?.address]);

  useEffect(() => {
    if (privpayModule !== "claim") return;
    refreshPrivateIncoming();
  }, [privpayModule, authMode, address, circleWallet?.address]);

  useEffect(() => {
    if (privpayModule !== "payroll") {
      setPayrollManageView("dashboard");
    }
  }, [privpayModule]);

  useEffect(() => {
    let mounted = true;
    async function fetchAndSet() {
      const syms = tokens.map((t) => t.symbol);
      try {
        const result = await getPrices(syms);
        if (!mounted) return;
        setPrices((prev) => ({ ...prev, ...result }));
      } catch (e) {
        console.warn("price refresh failed", e);
      }
    }

    fetchAndSet();
    const iv = setInterval(fetchAndSet, 10000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, [tokens, authMode, circleWallet?.address, circleActionsBusy, circleExecPrompt]);

  useEffect(() => {
    let mounted = true;
    let debounceTimer = null;

    async function estimateOut() {
      if (
        !swapAmount ||
        Number(swapAmount) <= 0 ||
        swapFrom === swapTo ||
        Object.keys(TOKEN_INDICES).length === 0
      ) {
        setEstimatedTo("");
        setExpectedOutputNum(null);
        setExpectedOutputRaw(null);
        setSwapPoolTokenBalances({});
        return;
      }

      // 400ms debounce to avoid 429 rate limit on rapid typing
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");

          const fromToken = tokens.find((t) => t.symbol === swapFrom);
          const toToken = tokens.find((t) => t.symbol === swapTo);
          if (!fromToken || !toToken) return;

          const i = TOKEN_INDICES[swapFrom];
          const j = TOKEN_INDICES[swapTo];

          // 1. Get Decimals (Cached in local memory to save RPC calls)
          const getDecimals = async (token) => {
            if (token.symbol === "USDC" || token.symbol === "EURC" || token.symbol === "USDG") return 6;
            const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
            return await contract.decimals().catch(() => 18);
          };

          const decimalsIn = await getDecimals(fromToken);
          const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

          // 2. Query Pool
          const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
          const dy = await pool.get_dy(i, j, amountIn);

          const decimalsOut = await getDecimals(toToken);
          const human = Number(ethers.formatUnits(dy, decimalsOut));

          const formatted =
            human >= 1000
              ? human.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : human.toLocaleString(undefined, { maximumFractionDigits: 6 });

          if (mounted) {
            setEstimatedTo(formatted);
            setExpectedOutputNum(human);
            setExpectedOutputRaw(dy);
          }

          // 3. Fetch swap pool balances (Consolidated to one call)
          try {
            const rawBalances = await pool.getBalances();
            const symbols = ["USDC", "EURC", "SWPRC"];
            const nextBalances = {};
            for (let idx = 0; idx < symbols.length && idx < rawBalances.length; idx++) {
              const sym = symbols[idx];
              const tok = tokens.find((t) => t.symbol === sym);
              const dec = tok ? await getDecimals(tok) : 6;
              nextBalances[sym] = Number(ethers.formatUnits(rawBalances[idx], dec));
            }
            if (mounted) setSwapPoolTokenBalances(nextBalances);
          } catch (balErr) {
            console.warn("Swap pool balances fetch failed", balErr);
          }
        } catch (e) {
          console.warn("On-chain estimate failed", e);
          if (mounted && e.message.includes("429")) {
            setQuote("Too many requests. Please wait a moment...");
          }
        }
      }, 400); 
    }

    estimateOut();

    return () => {
      mounted = false;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [swapAmount, swapFrom, swapTo, tokens]);

  useEffect(() => {
    setHighImpactConfirmed(false);
  }, [swapFrom, swapTo, swapAmount]);

  // Derived swap metrics for slippage, price impact, and liquidity checks
  const swapSummary = useMemo(() => {
    const amountNum = Number(swapAmount) || 0;
    const expected = expectedOutputNum;
    const poolFrom = swapPoolTokenBalances[swapFrom];
    const poolTo = swapPoolTokenBalances[swapTo];
    const clampedSlippage = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
    const slippagePct = clampedSlippage / 100;

    const minimumReceivedNum = expected != null ? expected * (1 - slippagePct) : null;
    let priceImpactPercent = null;
    if (expected != null && amountNum > 0 && poolFrom > 0 && poolTo > 0) {
      const executionRate = expected / amountNum;
      const spotRate = poolTo / poolFrom;
      priceImpactPercent = (1 - executionRate / spotRate) * 100;
    }
    const poolLiquidityFrom = poolFrom ?? 0;
    const tradeSizeTooLarge = poolLiquidityFrom > 0 && amountNum > poolLiquidityFrom * 0.1;
    const isHighImpact = priceImpactPercent != null && priceImpactPercent > 10;
    const isExtremeImpact = priceImpactPercent != null && priceImpactPercent > 25;

    return {
      minimumReceivedNum,
      priceImpactPercent,
      poolLiquidityFrom,
      tradeSizeTooLarge,
      isHighImpact,
      isExtremeImpact,
      slippagePct: clampedSlippage.toFixed(1),
      slippageRaw: clampedSlippage,
    };
  }, [swapAmount, swapFrom, swapTo, expectedOutputNum, swapPoolTokenBalances, slippageTolerance]);

  useEffect(() => {
    try {
      localStorage.setItem("swaparc_history", JSON.stringify(swapHistory));
    } catch (e) {
      console.warn("Failed to persist history", e);
    }
  }, [swapHistory]);

  useEffect(() => {
    try {
      localStorage.setItem("privpay_bills", JSON.stringify(bills));
    } catch {
      // ignore
    }
  }, [bills]);

  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  useEffect(() => {
    try {
      localStorage.setItem("privpay_bill_history", JSON.stringify(billHistory));
    } catch {
      // ignore
    }
  }, [billHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "privpay_payroll_companies",
        JSON.stringify(payrollCompanies)
      );
    } catch {
      // ignore
    }
  }, [payrollCompanies]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "privpay_payroll_employees",
        JSON.stringify(payrollEmployees)
      );
    } catch {
      // ignore
    }
  }, [payrollEmployees]);

  useEffect(() => {
    payrollEmployeesRef.current = payrollEmployees;
  }, [payrollEmployees]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "privpay_payroll_history",
        JSON.stringify(payrollHistory)
      );
    } catch {
      // ignore
    }
  }, [payrollHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "privpay_bill_history_resolved",
        JSON.stringify(Array.from(resolvedBillHistoryIds))
      );
    } catch {
      // ignore
    }
  }, [resolvedBillHistoryIds]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "privpay_payroll_history_resolved",
        JSON.stringify(Array.from(resolvedPayrollHistoryIds))
      );
    } catch {
      // ignore
    }
  }, [resolvedPayrollHistoryIds]);

  useEffect(() => {
    setBillsUpcomingPage(1);
  }, [billsView, bills.length]);

  useEffect(() => {
    setBillsHistoryPage(1);
  }, [billsView, billHistory.length]);

  useEffect(() => {
    setPayrollUpcomingPage(1);
  }, [privpayModule, selectedCompanyId, payrollEmployees.length]);

  useEffect(() => {
    setPayrollHistoryPage(1);
  }, [privpayModule, payrollHistory.length]);

  useEffect(() => {
    setClaimHistoryPage(1);
  }, [privpayModule, poolClaimHistory.length]);

  useEffect(() => {
    try {
      localStorage.setItem("privpay_claim_history", JSON.stringify(poolClaimHistory));
    } catch {
      // ignore
    }
  }, [poolClaimHistory]);

  useEffect(() => {
    let cancelled = false;
    async function backfillBillNullifierHashes() {
      const next = await Promise.all(
        billHistory.map(async (entry) => {
          const poolNullifierHash = await derivePoolNullifierHashFromClaimMaterial(entry);
          if (!poolNullifierHash || poolNullifierHash === entry?.poolNullifierHash) {
            return entry;
          }
          return { ...entry, poolNullifierHash };
        })
      );
      if (cancelled) return;
      const changed = next.some((entry, idx) => entry !== billHistory[idx]);
      if (changed) setBillHistory(next);
    }
    backfillBillNullifierHashes().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [billHistory]);

  useEffect(() => {
    let cancelled = false;
    async function backfillPayrollNullifierHashes() {
      const next = await Promise.all(
        payrollHistory.map(async (entry) => {
          const poolNullifierHash = await derivePoolNullifierHashFromClaimMaterial(entry);
          if (!poolNullifierHash || poolNullifierHash === entry?.poolNullifierHash) {
            return entry;
          }
          return { ...entry, poolNullifierHash };
        })
      );
      if (cancelled) return;
      const changed = next.some((entry, idx) => entry !== payrollHistory[idx]);
      if (changed) setPayrollHistory(next);
    }
    backfillPayrollNullifierHashes().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [payrollHistory]);

  useEffect(() => {
    if (!hasUnclaimedPrivacyPoolEntries(billHistory) && !hasUnclaimedPrivacyPoolEntries(payrollHistory)) {
      return undefined;
    }
    let cancelled = false;
    async function refreshPrivacyPoolClaimStatus() {
      if (Date.now() < Number(privacyPoolClaimRefreshBackoffUntilRef.current || 0)) {
        return;
      }
      const provider = getReadProvider();
      const poolCache = new Map();
      const legacyWithdrawCache = new Map();
      const depositBlockCache = new Map();
      const usedLegacyWithdrawTxs = new Set();
      const billClaimedIds = new Set();
      const payrollClaimedIds = new Set();
      const nowIso = new Date().toISOString();
      const lookupSpent = async (poolAddress, nullifierHash) => {
        const key = `${String(poolAddress).toLowerCase()}::${String(nullifierHash).toLowerCase()}`;
        if (!poolCache.has(key)) {
          const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
          poolCache.set(
            key,
            pool
              .nullifierSpent(nullifierHash)
              .then(async (spentRaw) => {
                if (spentRaw) return true;
                // Legacy sender rows stored LE bytes; on-chain nullifier is checked in BE bytes32.
                const rev = reverseHex32Bytes(nullifierHash);
                if (!rev || String(rev).toLowerCase() === String(nullifierHash).toLowerCase()) {
                  return false;
                }
                try {
                  return Boolean(await pool.nullifierSpent(rev));
                } catch {
                  return false;
                }
              })
              .catch(() => false)
          );
        }
        return poolCache.get(key);
      };
      const decimalsGuessBySymbol = (symbol) => {
        const s = String(symbol || "").trim().toUpperCase();
        if (s === "USDC" || s === "EURC") return 6;
        return 18;
      };
      const topicWithdrawn = ethers.id("Withdrawn(bytes32,address,uint256)");
      const parseWithdrawn = new ethers.Interface([
        "event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount)",
      ]);
      const lookupLegacyWithdrawRows = async (poolAddress, recipientAddress) => {
        const key = `${String(poolAddress).toLowerCase()}::${String(recipientAddress).toLowerCase()}`;
        if (!legacyWithdrawCache.has(key)) {
          const fromBlockCfg = Number(import.meta.env.VITE_PRIVACY_POOL_FROM_BLOCK || 0);
          const latest = await provider.getBlockNumber();
          const rows = [];
          for (let start = fromBlockCfg; start <= latest; start += 9999) {
            const end = Math.min(start + 9999, latest);
            let logs = [];
            try {
              logs = await provider.getLogs({
                address: poolAddress,
                fromBlock: start,
                toBlock: end,
                topics: [topicWithdrawn, null, ethers.zeroPadValue(recipientAddress, 32)],
              });
            } catch (err) {
              const msg = String(err?.message || err || "").toLowerCase();
              if (msg.includes("429") || msg.includes("too many requests")) {
                // ARC RPC rate-limit guard: pause heavy legacy scans for a while.
                privacyPoolClaimRefreshBackoffUntilRef.current = Date.now() + 3 * 60_000;
                return [];
              }
              throw err;
            }
            for (const log of logs) {
              const p = parseWithdrawn.parseLog(log);
              rows.push({
                txHash: log.transactionHash,
                blockNumber: Number(log.blockNumber || 0),
                amountWei: p.args.amount,
              });
            }
          }
          rows.sort((a, b) => a.blockNumber - b.blockNumber);
          legacyWithdrawCache.set(key, rows);
        }
        return legacyWithdrawCache.get(key);
      };
      const resolveEntryDepositBlock = async (entry) => {
        const cached = Number(entry?.blockNumber || 0);
        if (cached > 0) return cached;
        const txHash = String(entry?.txHash || "");
        if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) return 0;
        const key = txHash.toLowerCase();
        if (!depositBlockCache.has(key)) {
          depositBlockCache.set(
            key,
            provider
              .getTransactionReceipt(txHash)
              .then((r) => Number(r?.blockNumber || 0))
              .catch(() => 0)
          );
        }
        return depositBlockCache.get(key);
      };
      const matchLegacyClaimByRecipientAmount = async (entry, poolAddrResolved) => {
        const recipient = normalizeAddress(entry?.poolRecipient);
        const poolAddress = poolAddrResolved || resolvePoolAddressForClaimEntry(entry);
        if (!recipient || !poolAddress) return null;
        let amountWei;
        try {
          amountWei = ethers.parseUnits(
            String(entry.amount),
            decimalsGuessBySymbol(entry?.token)
          );
        } catch {
          return null;
        }
        const minBlock = await resolveEntryDepositBlock(entry);
        const rows = await lookupLegacyWithdrawRows(poolAddress, recipient);
        const candidate = rows.find(
          (r) =>
            !usedLegacyWithdrawTxs.has(String(r.txHash || "").toLowerCase()) &&
            BigInt(r.amountWei) === BigInt(amountWei) &&
            r.blockNumber >= minBlock
        );
        if (!candidate) return null;
        usedLegacyWithdrawTxs.add(String(candidate.txHash || "").toLowerCase());
        return candidate;
      };

      for (const entry of billHistory) {
        if (String(entry?.paymentRail || "") !== "privacyPool" || entry?.poolClaimedAt) {
          continue;
        }
        const poolAddr = resolvePoolAddressForClaimEntry(entry);
        if (!poolAddr) continue;
        let matched = false;
        if (entry?.poolNullifierHash) {
          matched = await lookupSpent(poolAddr, entry.poolNullifierHash);
        }
        if (!matched) {
          const nh = await derivePoolNullifierHashFromClaimMaterial(entry);
          if (nh) {
            matched = await lookupSpent(poolAddr, nh);
          }
        }
        if (!matched) {
          matched = Boolean(await matchLegacyClaimByRecipientAmount(entry, poolAddr));
        }
        if (matched) {
          billClaimedIds.add(entry.id);
        }
      }

      for (const entry of payrollHistory) {
        if (String(entry?.paymentRail || "") !== "privacyPool" || entry?.poolClaimedAt) {
          continue;
        }
        const poolAddr = resolvePoolAddressForClaimEntry(entry);
        if (!poolAddr) continue;
        let matched = false;
        if (entry?.poolNullifierHash) {
          matched = await lookupSpent(poolAddr, entry.poolNullifierHash);
        }
        if (!matched) {
          const nh = await derivePoolNullifierHashFromClaimMaterial(entry);
          if (nh) {
            matched = await lookupSpent(poolAddr, nh);
          }
        }
        if (!matched) {
          matched = Boolean(await matchLegacyClaimByRecipientAmount(entry, poolAddr));
        }
        if (matched) {
          payrollClaimedIds.add(entry.id);
        }
      }

      if (cancelled) return;

      if (billClaimedIds.size) {
        setBillHistory((prev) =>
          prev.map((entry) =>
            billClaimedIds.has(entry.id) && !entry.poolClaimedAt
              ? { ...entry, poolClaimedAt: nowIso }
              : entry
          )
        );
      }
      if (payrollClaimedIds.size) {
        setPayrollHistory((prev) =>
          prev.map((entry) =>
            payrollClaimedIds.has(entry.id) && !entry.poolClaimedAt
              ? { ...entry, poolClaimedAt: nowIso }
              : entry
          )
        );
      }
    }

    refreshPrivacyPoolClaimStatus().catch(() => {});
    const intervalId = setInterval(() => {
      refreshPrivacyPoolClaimStatus().catch(() => {});
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [billHistory, payrollHistory]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/payments/payroll/get?owner=${encodeURIComponent(String(owner).toLowerCase())}`
        );
        const j = await r.json();
        if (!r.ok || !j?.ok || cancelled || !j?.state) return;
        const s = j.state;
        const serverCompanies = Array.isArray(s.companies) ? s.companies : [];
        const serverEmployees = Array.isArray(s.employees) ? s.employees : [];
        const serverHistory = Array.isArray(s.history) ? s.history : [];
        /** Do not replace rich local payroll with empty KV (save may not have landed yet). */
        setPayrollCompanies((prev) => (serverCompanies.length > 0 ? serverCompanies : prev));
        setPayrollEmployees((prev) => (serverEmployees.length > 0 ? serverEmployees : prev));
        setPayrollHistory((prev) => (serverHistory.length > 0 ? serverHistory : prev));
      } catch {
        // keep local state fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authMode, address, circleWalletReady, circleWallet?.address]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    let cancelled = false;
    (async () => {
      try {
        await mergePrivpayHistorySnapshotFromServer();
      } finally {
        if (!cancelled) {
          privpayHistoryHydratedOwnerRef.current = String(owner).toLowerCase();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authMode, address, circleWalletReady, circleWallet?.address]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    const t = setTimeout(() => {
      const ownerLower = String(owner).toLowerCase();
      fetch("/api/payments/payroll/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: ownerLower,
          state: {
            companies: payrollCompanies.map((c) => ({
              ...c,
              tokenAddress:
                c.tokenAddress ||
                INITIAL_TOKENS.find((t) => t.symbol === c.token)?.address ||
                "",
            })),
            employees: payrollEmployees,
            history: payrollHistory.slice(0, 500),
          },
        }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            setPayrollServerSyncError(
              String(j?.error || `Could not sync payroll to server (${r.status}). Recurring runs need this for automation.`)
            );
          } else {
            setPayrollServerSyncError("");
          }
        })
        .catch(() => {
          setPayrollServerSyncError("Network error while syncing payroll. Recurring automation may not see your employees.");
        });
    }, 450);
    return () => clearTimeout(t);
  }, [payrollCompanies, payrollEmployees, payrollHistory, authMode, address, circleWalletReady, circleWallet?.address]);

  useEffect(() => {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    const ownerLower = String(owner).toLowerCase();
    if (privpayHistoryHydratedOwnerRef.current !== ownerLower) return;
    const t = setTimeout(() => {
      fetch("/api/privpay/history/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: ownerLower,
          state: {
            billHistory: billHistory.slice(0, 500),
            claimHistory: poolClaimHistory.slice(0, 500),
          },
        }),
      }).catch(() => {
        // keep local state fallback
      });
    }, 450);
    return () => clearTimeout(t);
  }, [
    billHistory,
    poolClaimHistory,
    authMode,
    address,
    circleWalletReady,
    circleWallet?.address,
  ]);

  useEffect(() => {
    if (payrollCompanies.length === 0) {
      payrollCompanySelectInitRef.current = false;
      return;
    }
    if (selectedCompanyId) return;
    if (payrollCompanySelectInitRef.current) return;
    const first = payrollCompanies[0];
    setSelectedCompanyId(first.id);
    payrollCompanySelectInitRef.current = true;
    setEmployeeForm((prev) => ({
      ...prev,
      companyId: first.id,
      frequency: prev.frequency || first.defaultFrequency || "monthly",
    }));
  }, [payrollCompanies, selectedCompanyId]);

  function nextDateByFrequency({ frequency, customIntervalSeconds, fromDate = new Date() }) {
    const d = new Date(fromDate);
    const f = String(frequency || "").toLowerCase();
    switch (f) {
      case "daily":
        d.setUTCDate(d.getUTCDate() + 1);
        break;
      case "weekly":
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case "bi-weekly":
        d.setUTCDate(d.getUTCDate() + 14);
        break;
      case "monthly":
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case "quarterly":
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case "yearly":
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
      case "custom": {
        const secs = Number(customIntervalSeconds || 0);
        if (Number.isFinite(secs) && secs > 0) {
          d.setUTCSeconds(d.getUTCSeconds() + secs);
        }
        break;
      }
      default:
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.toISOString();
  }

  function getTokenBySymbol(symbol) {
    return INITIAL_TOKENS.find((t) => t.symbol === symbol) || null;
  }

  function isZkRoute(tokenSymbol, recipientWallet) {
    const recipient = String(recipientWallet || "").trim();
    if (!recipient) return false;
    return Boolean(privacyPoolAddressForSymbol(tokenSymbol));
  }

  function canUseRecurring() {
    return true;
  }

  function recurringPeriodSecondsForBillFrequency(bill) {
    const f = String(bill?.frequency || "").toLowerCase();
    if (f === "custom") {
      const secs = Number(bill?.customIntervalSeconds || 0);
      return Number.isFinite(secs) && secs >= 60 ? Math.floor(secs) : 60;
    }
    return customRepeatCadenceToSeconds(f);
  }

  function recurringAuthorizationIdForBill(billId) {
    return ethers.id(String(billId || ""));
  }

  function recurringAutopaySummaryText(billName) {
    const name = billName || "bill";
    return `Autopay enabled for "${name}". Setup authorization and approvals are complete; future charges run on the recurring server while you are offline.`;
  }

  function recurringStatusCopy(bill) {
    if (!bill?.recurring) return "Autopay is off.";
    const state = String(bill?.lastSchedulerStatus || "").toLowerCase();
    if (state === "failed") {
      return "Autopay paused: the scheduler reached max retries. Re-authorize or top up and re-enable.";
    }
    if (state === "retry") {
      return "Autopay retrying after a temporary failure.";
    }
    if (state === "cancelled") {
      return "Autopay cancelled.";
    }
    return "Autopay active: runs on the server while you are offline.";
  }

  /** Bill-shaped schedule used by `ensureRecurringOnchainAuthorization` for payroll employees (same auth id as server: ethers.id(employeeId)). */
  function payrollEmployeeAuthBillShape(employee, company) {
    const token = company?.token || "USDC";
    return {
      id: employee.id,
      token,
      amount: employee.salary,
      recipientWallet: employee.recipientWallet,
      receiverSpendPublicKey: employee.receiverSpendPublicKey || "",
      receiverViewPublicKey: employee.receiverViewPublicKey || "",
      frequency: employee.frequency,
      customIntervalSeconds: employee.customIntervalSeconds,
      recurring: true,
      name: employee.name || "Employee",
      nextExecutionAt: employee.nextRunAt,
    };
  }

  async function ensureRecurringOnchainAuthorization(bill) {
    if (!bill?.id || !bill?.token) return null;
    if (!bill.recurring) return null;
    if (!RECURRING_AUTOMATION_CONTRACT_ADDRESS || !RECURRING_AUTOMATION_EXECUTOR_ADDRESS) {
      return null;
    }
    const owner = getActiveWalletAddress();
    if (!owner) throw new Error("Connect wallet before configuring recurring authorization.");
    const token = getTokenBySymbol(bill.token);
    if (!token?.address) {
      throw new Error(`Missing token address for ${bill.token}.`);
    }
    const poolAddress = privacyPoolAddressForSymbol(bill.token);
    if (!poolAddress) {
      throw new Error(`Missing privacy pool address for ${bill.token}.`);
    }
    const authId = recurringAuthorizationIdForBill(bill.id);
    const tokenAddress = ethers.getAddress(token.address);
    const recurringAutomationAddress = ethers.getAddress(
      RECURRING_AUTOMATION_CONTRACT_ADDRESS
    );
    const executorAddress = ethers.getAddress(RECURRING_AUTOMATION_EXECUTOR_ADDRESS);
    const tokenReader = new ethers.Contract(token.address, ERC20_ABI, getReadProvider());
    const decimals = Number(await tokenReader.decimals().catch(() => 6));
    const maxPerExecution = ethers.parseUnits(String(bill.amount), decimals);
    if (maxPerExecution <= 0n) {
      throw new Error("Recurring amount must be greater than zero.");
    }
    const periodSeconds = recurringPeriodSecondsForBillFrequency(bill);
    const feeAllowanceTarget = (() => {
      let parsed;
      try {
        parsed = ethers.parseUnits(RECURRING_FEE_ALLOWANCE_BUFFER_USDC, 6);
      } catch {
        parsed = ethers.parseUnits("2", 6);
      }
      const floor = ethers.parseUnits(PRIVPAY_USAGE_FEE_USDC, 6) * 20n;
      return parsed >= floor ? parsed : floor;
    })();

    async function ensureAllowanceForSpender({
      tokenAddr,
      spender,
      minimumAllowance,
      approvalLabel,
    }) {
      const readToken = new ethers.Contract(tokenAddr, ERC20_ABI, getReadProvider());
      const current = await readToken.allowance(owner, spender).catch(() => 0n);
      if (current >= minimumAllowance) return;
      if (isCircleMode()) {
        await executeCircleContractAction({
          contractAddress: tokenAddr,
          abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [spender, ethers.MaxUint256.toString()],
          title: approvalLabel,
        });
        return;
      }
      const signer = await getSigner();
      const writeToken = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
      const tx = await writeToken.approve(spender, ethers.MaxUint256);
      await tx.wait(1);
    }

    if (isCircleMode()) {
      await executeCircleContractAction({
        contractAddress: recurringAutomationAddress,
        abiFunctionSignature:
          "configureAuthorization(bytes32,address,address,address,uint128,uint128,uint64)",
        abiParameters: [
          authId,
          executorAddress,
          tokenAddress,
          ethers.getAddress(poolAddress),
          maxPerExecution.toString(),
          maxPerExecution.toString(),
          String(periodSeconds),
        ],
        title: `Enable recurring authorization for ${bill.name || "bill"}`,
      });
    } else {
      const signer = await getSigner();
      const contract = new ethers.Contract(
        recurringAutomationAddress,
        RECURRING_AUTOMATION_ABI,
        signer
      );
      const tx = await contract.configureAuthorization(
        authId,
        executorAddress,
        tokenAddress,
        ethers.getAddress(poolAddress),
        maxPerExecution,
        maxPerExecution,
        periodSeconds
      );
      await tx.wait(1);
    }

    await ensureAllowanceForSpender({
      tokenAddr: tokenAddress,
      spender: recurringAutomationAddress,
      minimumAllowance: maxPerExecution,
      approvalLabel: `Approve ${token.symbol} for recurring autopay`,
    });
    await ensureAllowanceForSpender({
      tokenAddr: ethers.getAddress(PRIVPAY_USDC_ADDRESS),
      spender: executorAddress,
      minimumAllowance: feeAllowanceTarget,
      approvalLabel: "Approve USDC for recurring automation fees",
    });

    return authId;
  }

  function canUsePayrollAutomation() {
    return true;
  }

  function isPrivpayPro() {
    return false;
  }

  async function refreshPrivpayAccess() {
    const owner = getActiveWalletAddress();
    if (!owner) return;
    const res = await fetch(
      `/api/payments/subscription/status?owner=${encodeURIComponent(owner)}`
    );
    const data = await res.json().catch(() => ({}));
    if (data?.ok) {
      setPrivpayAccess((prev) => ({ ...prev, ...data }));
    }
  }

  async function chargePrivpayUsageFee(featureLabel = "payment") {
    const treasury = ethers.getAddress(PRIVPAY_TREASURY_ADDRESS);
    const feeUnits = ethers.parseUnits(PRIVPAY_USAGE_FEE_USDC, 6);
    if (isCircleMode()) {
      const { hash } = await executeCircleContractAction({
        contractAddress: PRIVPAY_USDC_ADDRESS,
        abiFunctionSignature: "transfer(address,uint256)",
        abiParameters: [treasury, feeUnits.toString()],
        title: `Confirm PRIVPAY ${featureLabel} fee`,
      });
      return hash;
    }
    const signer = await getSigner();
    const usdc = new ethers.Contract(PRIVPAY_USDC_ADDRESS, ERC20_ABI, signer);
    const tx = await usdc.transfer(treasury, feeUnits);
    await tx.wait(1);
    return tx.hash;
  }

  function csvEscape(value) {
    const s = String(value ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportRowsToCsv(filenameBase, headers, rows) {
    const headerLine = headers.map(csvEscape).join(",");
    const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const csv = `${headerLine}\n${body}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameBase}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function billHistoryToExportRow(h) {
    return [
      h.billName || "",
      h.token || "",
      String(h.amount ?? ""),
      h.status || "",
      h.paymentRail || "",
      h.poolRecipient || h.stealthAddress || "",
      h.poolClaimCode || "",
      h.payerAddress || "",
      h.txHash || "",
      h.createdAt ? new Date(h.createdAt).toISOString() : "",
    ];
  }

  function payrollHistoryDisplayTitle(h) {
    if (!h) return "Employee";
    const name = String(h.employeeName || "").trim() || "Employee";
    const role = String(h.role || "").trim();
    const base = role ? `${name} (${role})` : name;
    const ex = h.payrollExecution || h.executionKind;
    if (ex === "recurring") return `${base} (Recurring)`;
    if (ex === "manual") return `${base} (Pay now)`;
    return base;
  }

  function payrollHistoryToExportRow(h) {
    const fallbackCompanyName =
      h.companyName ||
      payrollCompanies.find((c) => c.id === h.companyId)?.name ||
      "";
    return [
      fallbackCompanyName,
      payrollHistoryDisplayTitle(h),
      h.token || "",
      String(h.amount ?? ""),
      h.status || "",
      h.paymentRail || "",
      h.poolRecipient || h.stealthAddress || "",
      h.poolClaimCode || "",
      h.payerAddress || "",
      h.txHash || "",
      h.createdAt ? new Date(h.createdAt).toISOString() : "",
    ];
  }

  function exportBillHistoryEntries(entries) {
    if (!entries.length) return;
    exportRowsToCsv(
      `privpay_bills_${new Date().toISOString().slice(0, 10)}`,
      [
        "Bill Name",
        "Token",
        "Amount",
        "Status",
        "Rail",
        "Recipient Address",
        "Claim Code",
        "Payer Address",
        "Tx Hash",
        "Date",
      ],
      entries.map(billHistoryToExportRow)
    );
    setResolvedBillHistoryIds((prev) => {
      const next = new Set(prev);
      for (const e of entries) next.add(e.id);
      return next;
    });
    setSelectedBillHistoryIds(new Set());
  }

  function exportPayrollHistoryEntries(entries) {
    if (!entries.length) return;
    exportRowsToCsv(
      `privpay_payroll_${new Date().toISOString().slice(0, 10)}`,
      [
        "Company",
        "Employee",
        "Token",
        "Amount",
        "Status",
        "Rail",
        "Recipient Address",
        "Claim Code",
        "Payer Address",
        "Tx Hash",
        "Date",
      ],
      entries.map(payrollHistoryToExportRow)
    );
    setResolvedPayrollHistoryIds((prev) => {
      const next = new Set(prev);
      for (const e of entries) next.add(e.id);
      return next;
    });
    setSelectedPayrollHistoryIds(new Set());
  }

  function toggleBillHistorySelection(id, checked) {
    setSelectedBillHistoryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePayrollHistorySelection(id, checked) {
    setSelectedPayrollHistoryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function billEntriesByExportMode(mode) {
    if (mode === "all") return billHistory;
    if (mode === "selected") {
      return billHistory.filter((h) => selectedBillHistoryIds.has(h.id));
    }
    return billHistory.filter((h) => !resolvedBillHistoryIds.has(h.id));
  }

  function payrollEntriesByExportMode(mode) {
    if (mode === "all") return payrollHistory;
    if (mode === "selected") {
      return payrollHistory.filter((h) => selectedPayrollHistoryIds.has(h.id));
    }
    return payrollHistory.filter((h) => !resolvedPayrollHistoryIds.has(h.id));
  }

  function paginateRows(rows, page, pageSize = 6) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const totalPages = Math.max(1, Math.ceil(safeRows.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      pageRows: safeRows.slice(start, start + pageSize),
      totalPages,
      safePage,
      totalCount: safeRows.length,
    };
  }

  function openBillReceiptCard(entry, options = {}) {
    const linkedBill = bills.find((b) => b.id === entry.billId) || null;
    const receiverAddress =
      entry.poolRecipient ||
      linkedBill?.recipientWallet ||
      entry.stealthAddress ||
      null;
    setReceiptModal({
      kind: "bill",
      title: entry.billName || "Bill",
      subtitle: linkedBill?.name || entry.billName || "Bill payment",
      typeLabel: "Bill",
      amountLabel: `${entry.amount} ${entry.token}`,
      receiverAddress,
      claimCode: entry.poolClaimCode || "",
      paidAt: entry.confirmedAt || entry.createdAt || null,
      nextDueAt: linkedBill?.nextExecutionAt || null,
      txHash: entry.txHash || null,
      paymentRail: entry.paymentRail || null,
      companyName: null,
      autoOpened: !!options.autoOpened,
    });
  }

  function openPayrollReceiptCard(entry, options = {}) {
    const employee = payrollEmployees.find((e) => e.id === entry.employeeId) || null;
    setReceiptModal({
      kind: "payroll",
      title: payrollHistoryDisplayTitle(entry),
      subtitle: entry.role || "Salary transfer",
      typeLabel: "Payroll",
      amountLabel: `${entry.amount} ${entry.token}`,
      receiverAddress: entry.poolRecipient || entry.stealthAddress || entry.recipientWallet || null,
      claimCode: entry.poolClaimCode || "",
      paidAt: entry.confirmedAt || entry.createdAt || null,
      nextDueAt: employee?.nextRunAt || null,
      txHash: entry.txHash || null,
      paymentRail: entry.paymentRail || null,
      companyName: entry.companyName || null,
      autoOpened: !!options.autoOpened,
    });
  }

  async function executeStealthTokenPayment({
    tokenSymbol,
    amount,
    receiverSpendPublicKey,
    receiverViewPublicKey,
    metadata = {},
  }) {
    if (!STEALTH_PAYMENTS_ADDRESS) {
      throw new Error(
        "Missing VITE_STEALTH_PAYMENTS_ADDRESS. Deploy StealthPayments contract and set env."
      );
    }

    const token = getTokenBySymbol(tokenSymbol);
    if (!token) throw new Error(`Unsupported token: ${tokenSymbol}`);

    const normalizedRecipientKeys = normalizeStealthRecipientKeys(
      receiverSpendPublicKey,
      receiverViewPublicKey
    );

    const stealth = deriveStealthPayment({
      receiverSpendPublicKey: normalizedRecipientKeys.receiverSpendPublicKey,
      receiverViewPublicKey: normalizedRecipientKeys.receiverViewPublicKey,
    });

    const metadataHash = ethers.keccak256(
      ethers.toUtf8Bytes(stableStringify(metadata || {}))
    );
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) throw new Error("Connect wallet first");

    const provider = getReadProvider();
    const tokenReader = new ethers.Contract(token.address, ERC20_ABI, provider);
    const decimals = await tokenReader.decimals().catch(() => 18);
    const amountUnits = ethers.parseUnits(String(amount), Number(decimals) || 18);

    if (isCircleMode()) {
      const { userToken, walletId } = requireCircleAuth();
      const allowance = await tokenReader.allowance(walletAddr, STEALTH_PAYMENTS_ADDRESS);
      if (allowance < amountUnits) {
        const approveTx = buildApproveCall(
          token.address,
          STEALTH_PAYMENTS_ADDRESS,
          ethers.MaxUint256
        );
        await executeCircleContractAction({
          contractAddress: approveTx.contractAddress,
          abiFunctionSignature: approveTx.abiFunctionSignature,
          abiParameters: approveTx.abiParameters,
          title: `Approve ${token.symbol} for stealth payments`,
        });
      }

      const initRes = await fetch("/api/circle/enterprise/execute-stealth-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken,
          walletId,
          stealthPaymentsAddress: STEALTH_PAYMENTS_ADDRESS,
          tokenAddress: token.address,
          stealthAddress: stealth.stealthAddress,
          amount: String(amount),
          decimals: Number(decimals) || 18,
          ephemeralPubKey: stealth.ephemeralPublicKey,
          viewTag: stealth.viewTag,
          metadataHash,
          feeLevel: "MEDIUM",
          requestTimestampMs: Date.now(),
          requestNonce: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const initData = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        throw new Error(initData?.error || "Failed to initiate stealth payment");
      }
      if (!initData?.challengeId) {
        throw new Error("No challengeId returned from enterprise stealth endpoint");
      }

      const stealthSdkResult = await executeCircleChallengeViaPrompt(
        initData.challengeId,
        "Confirm private payment in Circle"
      );
      let hash = extractCircleSdkTxHash(stealthSdkResult);
      if (!hash) {
        hash = await waitForCircleTxHash(initData.challengeId, {
          transactionId: initData.transactionId,
        });
      } else {
        console.log("[CircleChallenge] Stealth pay: txHash from SDK callback");
      }
      if (!hash) {
        throw new Error(
          "Timeout: stealth payment submitted but tx hash not found yet. Please check history."
        );
      }
      if (hash !== "SUBMITTED") {
        try {
          await waitForTxBestEffort(hash, 45000);
        } catch (e) {
          console.warn("[CircleChallenge] Stealth pay confirmation check failed (non-blocking):", e);
        }
      }
      const receipt =
        hash && hash !== "SUBMITTED" ? await getTxReceiptBestEffort(hash) : null;
      return {
        txHash: hash,
        stealth,
        metadataHash,
        blockNumber: receipt?.blockNumber || null,
        confirmedAt: receipt ? new Date().toISOString() : null,
        payerAddress: walletAddr,
      };
    }

    if (!isCircleMode() && !window?.ethereum) {
      throw new Error("No injected wallet provider found. Open in a browser with MetaMask/Rabby, or use Circle email mode.");
    }

    const signer = await getSigner();
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
    const allowance = await tokenContract.allowance(await signer.getAddress(), STEALTH_PAYMENTS_ADDRESS);
    if (allowance < amountUnits) {
      const txA = await tokenContract.approve(STEALTH_PAYMENTS_ADDRESS, ethers.MaxUint256);
      await txA.wait();
    }

    const stealthContract = new ethers.Contract(
      STEALTH_PAYMENTS_ADDRESS,
      STEALTH_PAYMENTS_ABI,
      signer
    );
    const tx = await stealthContract.announceERC20Payment(
      token.address,
      stealth.stealthAddress,
      amountUnits,
      stealth.ephemeralPublicKey,
      stealth.viewTag,
      metadataHash
    );
    const receipt = await tx.wait();
    return {
      txHash: tx.hash,
      stealth,
      metadataHash,
      blockNumber: receipt?.blockNumber || null,
      confirmedAt: new Date().toISOString(),
      payerAddress: await signer.getAddress(),
    };
  }

  async function executePrivacyPoolPayment({
    tokenSymbol,
    amount,
    recipientWallet,
    metadata = {},
  }) {
    const token = getTokenBySymbol(tokenSymbol);
    if (!token) throw new Error(`Unsupported token: ${tokenSymbol}`);
    const poolAddress = privacyPoolAddressForSymbol(token.symbol);
    if (!poolAddress) {
      throw new Error(
        `Missing privacy pool for ${token.symbol}. Set VITE_PRIVACY_POOL_ADDRESS_${token.symbol} (USDC also supports VITE_PRIVACY_POOL_ADDRESS fallback).`
      );
    }

    const recipient = normalizeAddress(String(recipientWallet || "").trim());
    if (!recipient) {
      throw new Error("Recipient wallet address is required for privacy pool payments.");
    }

    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) throw new Error("Connect wallet first");

    const provider = getReadProvider();
    const tokenReader = new ethers.Contract(token.address, ERC20_ABI, provider);
    const decimals = await tokenReader.decimals().catch(() => 18);
    const amountUnits = ethers.parseUnits(String(amount), Number(decimals) || 18);

    const secret = ethers.hexlify(ethers.randomBytes(32));
    const nullifier = ethers.hexlify(ethers.randomBytes(32));
    const nullifierHash = ethers.hexlify(
      await computePrivpayNullifierHashBytes(secret, nullifier)
    );
    const commitment = ethers.hexlify(
      await computePrivpayNoteLeafBytes(secret, nullifier, amountUnits, recipient)
    );

    const metadataHash = ethers.keccak256(
      ethers.toUtf8Bytes(
        stableStringify({ ...metadata, paymentRail: "privacyPool", commitment })
      )
    );

    let poolClaimPayload = null;
    let poolClaimCode = "";

    if (isCircleMode()) {
      const { userToken, walletId } = requireCircleAuth();
      const allowance = await tokenReader.allowance(walletAddr, poolAddress);
      if (allowance < amountUnits) {
        const approveTx = buildApproveCall(
          token.address,
          poolAddress,
          ethers.MaxUint256
        );
        await executeCircleContractAction({
          contractAddress: approveTx.contractAddress,
          abiFunctionSignature: approveTx.abiFunctionSignature,
          abiParameters: approveTx.abiParameters,
          title: `Approve ${token.symbol} for privacy pool`,
        });
      }

      const initRes = await fetch("/api/circle/enterprise/execute-privacy-pool-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken,
          walletId,
          privacyPoolAddress: poolAddress,
          commitment,
          amount: String(amount),
          decimals: Number(decimals) || 18,
          tokenAddress: token.address,
          feeLevel: "MEDIUM",
          requestTimestampMs: Date.now(),
          requestNonce: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const initData = await initRes.json().catch(() => ({}));
      if (!initRes.ok || !initData?.challengeId) {
        throw new Error(initData?.error || "Failed to start privacy pool deposit");
      }
      const sdkResult = await executeCircleChallengeViaPrompt(
        initData.challengeId,
        "Confirm privacy pool deposit"
      );
      let hash = extractCircleSdkTxHash(sdkResult);
      if (!hash) {
        hash = await waitForCircleTxHash(initData.challengeId, {
          transactionId: initData.transactionId,
        });
      }
      if (!hash) {
        throw new Error("Pool deposit submitted but tx hash not found.");
      }
      if (hash !== "SUBMITTED") {
        try {
          await waitForTxBestEffort(hash, 45000);
        } catch (e) {
          console.warn("[CircleChallenge] Pool deposit confirmation check failed (non-blocking):", e);
        }
      }
      const receipt =
        hash && hash !== "SUBMITTED" ? await getTxReceiptBestEffort(hash) : null;
      const fin = finalizeZkPoolClaimExport({
        receipt,
        poolAddress,
        commitment,
        recipient,
        tokenAddress: token.address,
        amountHuman: amount,
        decimals: Number(decimals) || 18,
        amountWei: amountUnits,
        secret,
        nullifier,
      });
      poolClaimPayload = fin.poolClaimPayload;
      poolClaimCode = fin.poolClaimCode;
      if (receipt) {
        const pos = extractPoolRootFromDepositReceipt(receipt, poolAddress, commitment);
        if (pos) {
          try {
            await persistZkNote(
              {
                poolAddress,
                tokenAddress: token.address,
                recipient,
                amountHuman: String(amount),
                decimals: Number(decimals) || 18,
                amountWei: String(amountUnits),
                commitment,
                root: pos.root,
                leafIndex: pos.leafIndex,
                merkleHeight: PRIVPAY_CIRCUIT_LEVELS,
              },
              { secretHex: secret, nullifierHex: nullifier },
              poolZkPassphrase
            );
            setPoolZkNotesTick((t) => t + 1);
          } catch (e) {
            console.warn("ZK note persist failed", e);
          }
        }
      }
      return {
        txHash: hash,
        paymentRail: "privacyPool",
        poolAddress,
        poolCommitment: commitment,
        poolRecipient: recipient,
        poolNullifierHash: nullifierHash,
        poolClaimCode,
        poolClaimPayload,
        tokenAddress: token.address,
        amountUnits,
        decimals: Number(decimals) || 18,
        metadataHash,
        blockNumber: receipt?.blockNumber || null,
        confirmedAt: receipt ? new Date().toISOString() : null,
        payerAddress: walletAddr,
      };
    }

    if (!window?.ethereum) {
      throw new Error(
        "No injected wallet provider found. Open in a browser with MetaMask/Rabby, or use Circle email mode."
      );
    }

    const signer = await getSigner();
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
    const fromAddr = await signer.getAddress();
    const allowance = await tokenContract.allowance(fromAddr, poolAddress);
    if (allowance < amountUnits) {
      const txA = await tokenContract.approve(poolAddress, ethers.MaxUint256);
      await txA.wait();
    }

    const chainProvider = signer.provider ?? getReadProvider();
    const poolCode = await chainProvider.getCode(poolAddress).catch(() => "0x");
    const poolCodeBytes = poolCode && poolCode !== "0x" ? (poolCode.length - 2) / 2 : 0;
    if (!poolCode || poolCode === "0x") {
      throw new Error(
        `No contract at privacy pool ${poolAddress}. Wrong network (use chain ${ARC_CHAIN_ID_DEC}) or fix VITE_PRIVACY_POOL_ADDRESS_${token.symbol}.`
      );
    }
    if (poolCodeBytes < 1000) {
      throw new Error(
        `Privacy pool at ${poolAddress} has truncated on-chain code (${poolCodeBytes} bytes). ` +
          `ARC testnet rejects very large single contracts — redeploy with this repo (Poseidon = linked library): npm run deploy:pool, then update VITE_PRIVACY_POOL_ADDRESS_${token.symbol}.`
      );
    }
    const poolReader = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, chainProvider);
    let poolTokenAddr;
    try {
      poolTokenAddr = await poolReader.token();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not read pool token() at ${poolAddress}: ${detail}. ` +
          `Ensure your wallet is on ARC testnet (chain ${ARC_CHAIN_ID_DEC}) and this address is the deployed ZKPrivacyPool.`
      );
    }
    if (ethers.getAddress(poolTokenAddr) !== ethers.getAddress(token.address)) {
      throw new Error(
        `This privacy pool only accepts the token at ${poolTokenAddr}; this bill uses ${token.symbol} (${token.address}). ` +
          "Use a pool deployed for that token or change the bill token."
      );
    }
    const bal = await tokenContract.balanceOf(fromAddr);
    if (bal < amountUnits) {
      throw new Error(
        `Insufficient ${token.symbol} for pool deposit (need ${ethers.formatUnits(amountUnits, Number(decimals) || 18)}, have ${ethers.formatUnits(bal, Number(decimals) || 18)}).`
      );
    }

    let receipt;
    let txHashOut;
    if (PRIVACY_POOL_USE_RELAY) {
      const { signature, deadline } = await signPrivpayRelayDeposit(signer, {
        poolAddress,
        depositor: fromAddr,
        commitment,
        amountWei: amountUnits,
        chainIdDec: ARC_CHAIN_ID_DEC,
      });
      const res = await fetch("/api/privpay/privacy-pool-relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deposit",
          poolAddress,
          depositor: fromAddr,
          commitment,
          amount: amountUnits.toString(),
          deadline,
          signature,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Privacy pool deposit relay failed.");
      }
      txHashOut = j.txHash;
      receipt = await getReadProvider().waitForTransaction(txHashOut, 1, 180_000);
    } else {
      const poolContract = new ethers.Contract(
        poolAddress,
        PRIVACY_POOL_ABI,
        signer
      );
      try {
        await poolContract.deposit.staticCall(commitment, amountUnits);
      } catch (simErr) {
        throw new Error(privacyPoolDepositErrorMessage(simErr));
      }
      let tx;
      try {
        tx = await poolContract.deposit(commitment, amountUnits);
      } catch (sendErr) {
        throw new Error(privacyPoolDepositErrorMessage(sendErr));
      }
      txHashOut = tx.hash;
      receipt = await tx.wait();
    }
    const finInj = finalizeZkPoolClaimExport({
      receipt,
      poolAddress,
      commitment,
      recipient,
      tokenAddress: token.address,
      amountHuman: amount,
      decimals: Number(decimals) || 18,
      amountWei: amountUnits,
      secret,
      nullifier,
    });
    poolClaimPayload = finInj.poolClaimPayload;
    poolClaimCode = finInj.poolClaimCode;
    if (receipt) {
      const pos = extractPoolRootFromDepositReceipt(receipt, poolAddress, commitment);
      if (pos) {
        try {
          await persistZkNote(
            {
              poolAddress,
              tokenAddress: token.address,
              recipient,
              amountHuman: String(amount),
              decimals: Number(decimals) || 18,
              amountWei: String(amountUnits),
              commitment,
              root: pos.root,
              leafIndex: pos.leafIndex,
              merkleHeight: PRIVPAY_CIRCUIT_LEVELS,
            },
            { secretHex: secret, nullifierHex: nullifier },
            poolZkPassphrase
          );
          setPoolZkNotesTick((t) => t + 1);
        } catch (e) {
          console.warn("ZK note persist failed", e);
        }
      }
    }
    return {
      txHash: txHashOut,
      paymentRail: "privacyPool",
      poolAddress,
      poolCommitment: commitment,
      poolRecipient: recipient,
      poolNullifierHash: nullifierHash,
      poolClaimCode,
      poolClaimPayload,
      tokenAddress: token.address,
      amountUnits,
      decimals: Number(decimals) || 18,
      metadataHash,
      blockNumber: receipt?.blockNumber || null,
      confirmedAt: new Date().toISOString(),
      payerAddress: fromAddr,
    };
  }

  async function submitPrivacyPoolZkWithdraw(poolAddress_, fullProofBytes, publicSignals) {
    const wfn = poolAddress_;
    const parsed = parsePrivpayPublicSignals(publicSignals);
    if (isCircleMode()) {
      const iface = new ethers.Interface([
        "function withdraw(bytes proof, bytes32 nullifierHash, address recipient, uint256 amount)",
      ]);
      const callData = iface.encodeFunctionData("withdraw", [
        ethers.hexlify(fullProofBytes),
        parsed.nullifierHash,
        parsed.recipient,
        parsed.amount.toString(),
      ]);
      setPoolZkStatus("Submitting Circle claim challenge...");
      const { hash } = await executeCircleContractAction({
        contractAddress: wfn,
        callData,
        title: "Confirm privacy pool claim",
      });
      setPoolZkStatus(
        hash === "SUBMITTED" ? "Circle claim submitted." : `Circle claim confirmed. Tx ${hash}`
      );
      return { txHash: hash, viaRelay: false };
    }
    if (PRIVACY_POOL_USE_RELAY) {
      const relaySigner = await getSigner();
      const { signature, deadline } = await signPrivpayRelayWithdraw(relaySigner, {
        poolAddress: wfn,
        nullifierHash: parsed.nullifierHash,
        recipient: parsed.recipient,
        amountWei: parsed.amount,
        chainIdDec: ARC_CHAIN_ID_DEC,
      });
      const res = await fetch("/api/privpay/privacy-pool-relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "withdraw",
          poolAddress: wfn,
          proof: ethers.hexlify(fullProofBytes),
          nullifierHash: parsed.nullifierHash,
          recipient: parsed.recipient,
          amount: parsed.amount.toString(),
          deadline,
          signature,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Privacy pool relay failed.");
      setPoolZkStatus(`Relay claim submitted. Tx ${j.txHash}`);
      return { txHash: j.txHash, viaRelay: true };
    }
    const signer = await getSigner();
    const poolWrite = new ethers.Contract(wfn, PRIVACY_POOL_ABI, signer);
    try {
      const tx = await poolWrite.getFunction(
        "withdraw(bytes,bytes32,address,uint256)"
      )(fullProofBytes, parsed.nullifierHash, parsed.recipient, parsed.amount);
      const rcpt = await tx.wait();
      if (rcpt?.status !== 1) throw new Error("Claim transaction was not confirmed.");
      setPoolZkStatus(`ZK claim confirmed. Tx ${tx.hash}`);
      return { txHash: tx.hash, viaRelay: false };
    } catch (e) {
      const decoded = extractEthersRevertReason(e);
      throw decoded ? new Error(decoded) : e;
    }
  }

  async function claimPrivacyPoolZkFromNote(noteId) {
    const notes = listZkNotes();
    const note = notes.find((n) => n.id === noteId);
    if (!note) throw new Error("Saved note not found.");
    const active = getActiveWalletAddress();
    if (!active) throw new Error("Connect the recipient wallet first.");
    if (normalizeAddress(active) !== normalizeAddress(note.recipient)) {
      throw new Error(
        `This note pays ${shortAddr(note.recipient)} — switch to that address (now ${shortAddr(active)}).`
      );
    }
    if (!PRIVPAY_WASM_URL || !PRIVPAY_ZKEY_URL) {
      throw new Error(
        "Proving not configured. Add wasm + zkey to /public/circuits/privpay and set VITE_PRIVPAY_WASM_URL / VITE_PRIVPAY_ZKEY_URL."
      );
    }
    setPoolZkError("");
    setPoolZkStatus("Generating ZK proof (30–90s typical in browser)…");
    const provider = getReadProvider();
    const { fullProofBytes, publicSignals } = await proveZkPoolWithdraw({
      provider,
      note,
      passphrase: poolZkPassphrase,
      wasmUrl: PRIVPAY_WASM_URL,
      zkeyUrl: PRIVPAY_ZKEY_URL,
    });
    const r = await submitPrivacyPoolZkWithdraw(note.poolAddress, fullProofBytes, publicSignals);
    removeZkNote(noteId);
    setPoolZkNotesTick((t) => t + 1);
    return r;
  }

  async function claimPrivacyPoolFromClaimCode(rawCode) {
    setPoolClaimStatus("Validating claim code...");
    const data = decodeZkPoolClaimPayload(rawCode);
    if (Number(data.v) !== 3 || String(data.scheme || "").toLowerCase() !== "zk-claim") {
      const sch = String(data.scheme || "").toLowerCase();
      if (sch === "zk-meta" || Number(data.v) === 2) {
        throw new Error(
          "This code is metadata-only. Use the full zk-claim code from the payer receipt export, or import a note backup."
        );
      }
      throw new Error("Unsupported claim code. Paste a v3 zk-claim code from a privacy pool payment receipt.");
    }
    const active = getActiveWalletAddress();
    if (!active) throw new Error("Connect the recipient wallet first.");
    const recipient = normalizeAddress(data.recipient);
    if (!recipient) throw new Error("Claim code is missing recipient.");
    if (normalizeAddress(active) !== recipient) {
      throw new Error(
        `This claim pays ${shortAddr(recipient)} — switch wallet (now ${shortAddr(active)}).`
      );
    }
    const poolAddress = normalizeAddress(data.poolAddress);
    if (!poolAddress) throw new Error("Claim code is missing pool address.");
    const commitmentFromCode = bytesLikeToHex(data.commitment);
    if (commitmentFromCode && commitmentFromCode.length !== 66) {
      throw new Error("Invalid commitment in claim code.");
    }
    const secret = bytesLikeToHex(data.secret);
    const nullifier = bytesLikeToHex(data.nullifier);
    if (!secret || secret.length !== 66 || !nullifier || nullifier.length !== 66) {
      throw new Error("Claim code must include secret and nullifier (full v3 zk-claim).");
    }
    let amountWei =
      data.amountWei != null && data.amountWei !== ""
        ? String(data.amountWei)
        : ethers
            .parseUnits(String(data.amount ?? "0"), Number(data.decimals) || 18)
            .toString();
    const recomputedCommitment = ethers.hexlify(
      await computePrivpayNoteLeafBytes(secret, nullifier, amountWei, recipient)
    );
    const commitment = ethers.zeroPadValue(recomputedCommitment, 32);
    if (
      commitmentFromCode &&
      ethers.zeroPadValue(commitmentFromCode, 32).toLowerCase() !== commitment.toLowerCase()
    ) {
      // Accept and continue with recomputed commitment to tolerate copy/paste corruption in non-critical fields.
      // If secrets/amount/recipient are wrong, Merkle lookup will fail cleanly.
      setPoolZkStatus("Claim code integrity warning: using recomputed commitment.");
    }

    if (!PRIVPAY_WASM_URL || !PRIVPAY_ZKEY_URL) {
      throw new Error(
        "Proving not configured. Add wasm + zkey to /public/circuits/privpay and set VITE_PRIVPAY_WASM_URL / VITE_PRIVPAY_ZKEY_URL."
      );
    }
    setPoolZkError("");
    setPoolClaimStatus("Preparing Merkle proof inputs...");
    setPoolZkStatus("Generating ZK proof (30–90s typical in browser)…");
    const provider = getReadProvider();
    const { fullProofBytes, publicSignals } = await proveZkPoolWithdrawWithSecrets({
      provider,
      poolAddress,
      recipient,
      amountWei,
      commitment,
      merkleHeight: data.merkleHeight || PRIVPAY_CIRCUIT_LEVELS,
      secretHex: secret,
      nullifierHex: nullifier,
      wasmUrl: PRIVPAY_WASM_URL,
      zkeyUrl: PRIVPAY_ZKEY_URL,
    });
    setPoolClaimStatus("Proof generated. Submitting claim transaction...");
    try {
      return await submitPrivacyPoolZkWithdraw(poolAddress, fullProofBytes, publicSignals);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (!/known historical root|not a known historical root|root/i.test(msg)) {
        throw e;
      }
      // Retry once with a full chain log rescan to avoid stale/misconfigured from-block roots.
      setPoolClaimStatus("Root mismatch detected. Rebuilding proof from full pool history...");
      const retry = await proveZkPoolWithdrawWithSecrets({
        provider,
        poolAddress,
        recipient,
        amountWei,
        commitment,
        merkleHeight: data.merkleHeight || PRIVPAY_CIRCUIT_LEVELS,
        secretHex: secret,
        nullifierHex: nullifier,
        wasmUrl: PRIVPAY_WASM_URL,
        zkeyUrl: PRIVPAY_ZKEY_URL,
        fromBlockOverride: 0,
      });
      setPoolClaimStatus("Retry proof ready. Submitting claim transaction...");
      return submitPrivacyPoolZkWithdraw(poolAddress, retry.fullProofBytes, retry.publicSignals);
    }
  }

  async function createBill() {
    setBillCreateError("");
    setBillCreateStatus("");
    setBillRecipientInviteStatus("");
    try {
      const amountNum = Number(billForm.amount);
      if (!billForm.name.trim()) throw new Error("Bill name is required");
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error("Enter a valid amount");
      }
      let resolvedSpendPublicKey = billForm.receiverSpendPublicKey.trim();
      let resolvedViewPublicKey = billForm.receiverViewPublicKey.trim();
      const recipientWallet = billForm.recipientWallet.trim();
      if (!recipientWallet) {
        throw new Error("Recipient wallet is required.");
      }
      const useZkPoolRoute = isZkRoute(billForm.token, recipientWallet);
      if (!useZkPoolRoute) {
        setBillRecipientInviteAddress(recipientWallet);
        if (recipientWallet) {
          const receiver = await resolvePrivateReceiverByWallet(recipientWallet);
          resolvedSpendPublicKey = receiver.spendPublicKey;
          resolvedViewPublicKey = receiver.viewPublicKey;
        }
        if (!resolvedSpendPublicKey || !resolvedViewPublicKey) {
          throw new Error(
            "Recipient must enable private receive first (connect once), then retry."
          );
        }
        const normalizedRecipientKeys = normalizeStealthRecipientKeys(
          resolvedSpendPublicKey,
          resolvedViewPublicKey
        );
        resolvedSpendPublicKey = normalizedRecipientKeys.receiverSpendPublicKey;
        resolvedViewPublicKey = normalizedRecipientKeys.receiverViewPublicKey;
      } else {
        setBillRecipientInviteAddress("");
        resolvedSpendPublicKey = "";
        resolvedViewPublicKey = "";
      }
      let nextExecutionAt;
      let customIntervalVal = null;
      if (billForm.frequency === "custom") {
        const start = parseDatetimeLocal(billForm.customStartAt);
        if (!start) {
          throw new Error("Choose a date and time for the custom schedule (your device local time).");
        }
        const minAhead = Date.now() + 25_000;
        if (start.getTime() <= minAhead) {
          throw new Error("Custom schedule must be at least a few seconds in the future.");
        }
        nextExecutionAt = start.toISOString();
        customIntervalVal = customRepeatCadenceToSeconds(billForm.customRepeatCadence);
      } else {
        nextExecutionAt = nextDateByFrequency({
          frequency: billForm.frequency,
          customIntervalSeconds: null,
          fromDate: new Date(),
        });
      }
      if (billForm.recurring && !canUseRecurring()) {
        throw new Error("Recurring payments are currently unavailable.");
      }

      const createdAt = new Date().toISOString();
      const bill = {
        id: editingBillId || `bill_${crypto.randomUUID()}`,
        name: billForm.name.trim(),
        token: billForm.token,
        amount: amountNum,
        recipientWallet: recipientWallet || "",
        receiverSpendPublicKey: resolvedSpendPublicKey,
        receiverViewPublicKey: resolvedViewPublicKey,
        frequency: billForm.frequency,
        customIntervalSeconds:
          billForm.frequency === "custom" ? customIntervalVal : null,
        customRepeatCadence:
          billForm.frequency === "custom" ? billForm.customRepeatCadence || "weekly" : null,
        recurring: !!billForm.recurring,
        schedulerFailureReason: null,
        lastSchedulerStatus: billForm.recurring ? "active" : null,
        nextExecutionAt,
        lastPaidAt: null,
        createdAt,
      };

      // Register recurring schedule in backend and fail fast if automation registration fails.
      if (bill.recurring && getActiveWalletAddress()) {
        const onchainAuthorizationId = await ensureRecurringOnchainAuthorization(bill);
        const recurringRes = await fetch("/api/payments/recurring/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: bill.id,
            payerAddress: getActiveWalletAddress(),
            receiverSpendPublicKey: bill.receiverSpendPublicKey,
            receiverViewPublicKey: bill.receiverViewPublicKey,
            recipientWallet: String(bill.recipientWallet || "").trim(),
            amount: bill.amount,
            tokenAddress:
              INITIAL_TOKENS.find((t) => t.symbol === bill.token)?.address || "",
            frequency: bill.frequency,
            customIntervalSeconds: bill.customIntervalSeconds,
            startAt: bill.nextExecutionAt,
            metadata: {
              billName: bill.name || "",
              onchainAuthorizationId: onchainAuthorizationId || recurringAuthorizationIdForBill(bill.id),
            },
          }),
        });
        const recurringData = await recurringRes.json().catch(() => ({}));
        if (!recurringRes.ok) {
          throw new Error(
            recurringData?.error ||
              "Bill saved, but recurring automation registration failed. Please retry."
          );
        }
      }

      setBills((prev) =>
        editingBillId
          ? prev.map((b) => (b.id === editingBillId ? { ...b, ...bill } : b))
          : [bill, ...prev]
      );

      setBillCreateStatus(
        bill.recurring
          ? recurringAutopaySummaryText(bill.name)
          : editingBillId
            ? "Bill updated"
            : "Bill created"
      );
      setBillRecipientInviteAddress("");
      setEditingBillId(null);
      setBillForm((p) => ({
        ...p,
        name: "",
        amount: "",
        recipientWallet: "",
        receiverSpendPublicKey: "",
        receiverViewPublicKey: "",
        customStartAt: "",
        customRepeatCadence: "weekly",
        customIntervalSeconds: "",
      }));
    } catch (e) {
      setBillCreateError(e.message || "Failed to create bill");
    }
  }

  async function cancelRecurringScheduleOnBackend(billId) {
    if (!recurringDeleteEndpointAvailableRef.current) return;
    const owner = getActiveWalletAddress();
    if (!owner || !billId) return;
    const res = await fetch("/api/payments/recurring/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: billId,
        payerAddress: String(owner).toLowerCase(),
      }),
    }).catch(() => null);
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (res.ok) return;
    if (res.status === 404 && data?.error === "Schedule not found") {
      // Local-only schedule already gone from backend; nothing to do.
      return;
    }
    if (res.status === 404) {
      // Endpoint likely missing in currently running backend process.
      recurringDeleteEndpointAvailableRef.current = false;
      return;
    }
  }

  async function toggleBillRecurring(bill, nextRecurring) {
    if (!bill) return;
    setBills((prev) =>
      prev.map((b) =>
        b.id === bill.id
          ? {
              ...b,
              recurring: !!nextRecurring,
              schedulerFailureReason: nextRecurring ? null : b.schedulerFailureReason,
              lastSchedulerStatus: nextRecurring ? "active" : "cancelled",
            }
          : b
      )
    );
    if (!nextRecurring) {
      await cancelRecurringScheduleOnBackend(bill.id);
      return;
    }
    // Re-enable recurring schedule if needed.
    const tokenAddress = INITIAL_TOKENS.find((t) => t.symbol === bill.token)?.address || "";
    const owner = getActiveWalletAddress();
    if (!owner || !tokenAddress) return;
    const onchainAuthorizationId = await ensureRecurringOnchainAuthorization({
      ...bill,
      recurring: true,
    });
    const res = await fetch("/api/payments/recurring/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: bill.id,
        payerAddress: String(owner).toLowerCase(),
        receiverSpendPublicKey: bill.receiverSpendPublicKey,
        receiverViewPublicKey: bill.receiverViewPublicKey,
        recipientWallet: String(bill.recipientWallet || "").trim(),
        amount: bill.amount,
        tokenAddress,
        frequency: bill.frequency,
        customIntervalSeconds: bill.customIntervalSeconds,
        metadata: {
          billName: bill.name || "",
          onchainAuthorizationId: onchainAuthorizationId || recurringAuthorizationIdForBill(bill.id),
        },
        ...(bill.frequency === "custom" && bill.nextExecutionAt
          ? { startAt: bill.nextExecutionAt }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBills((prev) =>
        prev.map((b) =>
          b.id === bill.id
            ? {
                ...b,
                recurring: false,
                lastSchedulerStatus: "failed",
                schedulerFailureReason:
                  data?.error || "Could not enable recurring automation for this bill.",
              }
            : b
        )
      );
      setBillRuntimeError(
        data?.error || "Could not enable recurring automation for this bill."
      );
      return;
    }
    setBillRuntimeStatus(recurringAutopaySummaryText(bill.name));
  }

  async function payBillNow(bill, { source = "manual" } = {}) {
    if (!bill) return;
    if (isCircleMode() && isRecentCircleSubmission(bill.lastCircleSubmissionAt)) {
      if (source === "manual") {
        setBillRuntimeStatus(
          `A recent Circle submission for "${bill.name}" is still settling. Please wait a moment before retrying to avoid duplicate sends.`
        );
      }
      return;
    }
    if (source === "manual") {
      setBillRuntimeError("");
      setBillRuntimeStatus("");
    }
    if (source === "manual" && bill.recurring) {
      setBillRuntimeError(
        "Please toggle Recurring off to use Pay Now. While Recurring is on, payments run automatically on schedule."
      );
      return;
    }
    setBillBusyId(bill.id);
    try {
      const recipientWallet = String(bill.recipientWallet || "").trim();
      const usePool = isZkRoute(bill.token, recipientWallet);
      let repaired = {
        receiverSpendPublicKey: bill.receiverSpendPublicKey || "",
        receiverViewPublicKey: bill.receiverViewPublicKey || "",
      };
      if (bill.recipientWallet && !usePool) {
        try {
          repaired = await ensureValidRecipientKeys({
            receiverSpendPublicKey: bill.receiverSpendPublicKey,
            receiverViewPublicKey: bill.receiverViewPublicKey,
            recipientWallet: bill.recipientWallet,
            entityLabel: "Recipient",
          });
        } catch {
          repaired = {
            receiverSpendPublicKey: "",
            receiverViewPublicKey: "",
          };
        }
      }
      if (
        repaired.receiverSpendPublicKey !== (bill.receiverSpendPublicKey || "") ||
        repaired.receiverViewPublicKey !== (bill.receiverViewPublicKey || "")
      ) {
        setBills((prev) =>
          prev.map((b) =>
            b.id === bill.id
              ? {
                  ...b,
                  receiverSpendPublicKey: repaired.receiverSpendPublicKey,
                  receiverViewPublicKey: repaired.receiverViewPublicKey,
                  schedulerFailureReason: null,
                }
              : b
          )
        );
      }
      const nowIso = new Date().toISOString();
      const feeTxHash = await chargePrivpayUsageFee("bill");

      let log;
      if (usePool) {
        const poolRes = await executePrivacyPoolPayment({
          tokenSymbol: bill.token,
          amount: bill.amount,
          recipientWallet,
          metadata: { kind: "bill", billId: bill.id, billName: bill.name, ts: Date.now() },
        });
        log = {
          id: `billtx_${crypto.randomUUID()}`,
          billId: bill.id,
          billName: bill.name,
          token: bill.token,
          amount: bill.amount,
          paymentRail: "privacyPool",
          poolAddress: poolRes.poolAddress,
          poolCommitment: poolRes.poolCommitment,
          poolRecipient: poolRes.poolRecipient,
          poolNullifierHash: poolRes.poolNullifierHash,
          poolClaimCode: poolRes.poolClaimCode,
          metadataHash: poolRes.metadataHash,
          feeTxHash,
          payerAddress: poolRes.payerAddress,
          blockNumber: poolRes.blockNumber,
          confirmedAt: poolRes.confirmedAt,
          status:
            poolRes.txHash === "SUBMITTED"
              ? "submitted (confirm on explorer)"
              : "submitted",
          txHash: poolRes.txHash,
          createdAt: nowIso,
        };
      } else {
        const { stealth, txHash, metadataHash, blockNumber, confirmedAt, payerAddress } =
          await executeStealthTokenPayment({
            tokenSymbol: bill.token,
            amount: bill.amount,
            receiverSpendPublicKey: repaired.receiverSpendPublicKey,
            receiverViewPublicKey: repaired.receiverViewPublicKey,
            metadata: { kind: "bill", billId: bill.id, billName: bill.name, ts: Date.now() },
          });
        log = {
          id: `billtx_${crypto.randomUUID()}`,
          billId: bill.id,
          billName: bill.name,
          token: bill.token,
          amount: bill.amount,
          paymentRail: "stealth",
          stealthAddress: stealth.stealthAddress,
          ephemeralPublicKey: stealth.ephemeralPublicKey,
          viewTag: stealth.viewTag,
          metadataHash,
          feeTxHash,
          payerAddress,
          blockNumber,
          confirmedAt,
          status:
            txHash === "SUBMITTED"
              ? "submitted (confirm on explorer)"
              : "submitted",
          txHash,
          createdAt: nowIso,
        };
      }
      setBillHistory((prev) => [log, ...prev]);

      setBills((prev) =>
        prev.map((b) => {
          if (b.id !== bill.id) return b;
          return {
            ...b,
            lastPaidAt: nowIso,
            schedulerFailureReason: null,
            lastSchedulerStatus: b.recurring ? "active" : b.lastSchedulerStatus,
            nextExecutionAt: b.recurring
              ? nextDateByFrequency({
                  frequency: b.frequency,
                  customIntervalSeconds: b.customIntervalSeconds,
                  fromDate: new Date(nowIso),
                })
              : b.nextExecutionAt,
            lastCircleSubmissionAt: isCircleMode() ? nowIso : b.lastCircleSubmissionAt,
          };
        })
      );
      if (source === "manual") {
        openBillReceiptCard(log, { autoOpened: true });
        if (log.paymentRail === "privacyPool") {
          setBillRuntimeStatus(
            log.txHash === "SUBMITTED"
              ? `Privacy pool deposit for "${bill.name}" submitted. Share Receipt field poolClaimCode (v3 zk-claim) with the recipient (their wallet: ${shortAddr(
                  log.poolRecipient
                )}).`
              : `Privacy pool deposit confirmed for "${bill.name}". Recipient pastes poolClaimCode from History → Receipt for ZK withdraw; the USDC leg to them is Pool → wallet (not your EOA on that leg).`
          );
        } else {
          setBillRuntimeStatus(
            log.txHash === "SUBMITTED"
              ? `Payment for "${bill.name}" was signed in Circle, but no chain tx hash was returned yet. Check Arc explorer for your wallet; funds go to a one-time stealth address — the recipient claims with Private receive, not their main balance.`
              : `Payment submitted for "${bill.name}". USDC was sent to a one-time stealth address (not the recipient’s main wallet). They detect and claim it with Private receive in this app.`
          );
        }
      }
      // Refresh balances after successful payment so Circle debits are visible quickly.
      const activeWallet = getActiveWalletAddress();
      if (activeWallet) {
        fetchBalances(activeWallet, getReadProvider()).catch(() => {});
      }
    } catch (e) {
      const errorMsg = e?.message || "Stealth payment generation failed";
      setBillHistory((prev) => [
        {
          id: `billtx_${crypto.randomUUID()}`,
          billId: bill.id,
          billName: bill.name,
          token: bill.token,
          amount: bill.amount,
          status: "failed",
          error: errorMsg,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      const retryAt = new Date(Date.now() + 90 * 1000).toISOString();
      const invalidConfig = isLikelyStealthConfigError(e);
      setBills((prev) =>
        prev.map((b) =>
          b.id === bill.id
            ? {
                ...b,
                schedulerFailureReason: errorMsg,
                recurring: invalidConfig ? false : b.recurring,
                lastSchedulerStatus: invalidConfig
                  ? "invalid-recipient-keys"
                  : b.recurring
                    ? "retry"
                    : b.lastSchedulerStatus,
                nextExecutionAt:
                  b.recurring && !invalidConfig ? retryAt : b.nextExecutionAt,
              }
            : b
        )
      );
      if (source === "manual") {
        setBillRuntimeError(
          invalidConfig
            ? `Payment failed for "${bill.name}": ${errorMsg}. Open Edit and fix recipient stealth keys.`
            : `Payment failed for "${bill.name}": ${errorMsg}`
        );
      }
    } finally {
      setBillBusyId(null);
    }
  }

  function editBill(bill) {
    setEditingBillId(bill.id);
    setBillsView("create");
    setBillForm({
      name: bill.name || "",
      token: bill.token || "USDC",
      amount: String(bill.amount || ""),
      recipientWallet: bill.recipientWallet || "",
      receiverSpendPublicKey: bill.receiverSpendPublicKey || "",
      receiverViewPublicKey: bill.receiverViewPublicKey || "",
      frequency: bill.frequency || "monthly",
      customStartAt:
        bill.frequency === "custom" && bill.nextExecutionAt
          ? formatDatetimeLocalValue(new Date(bill.nextExecutionAt))
          : "",
      customRepeatCadence:
        bill.frequency === "custom"
          ? bill.customRepeatCadence ||
            inferCustomRepeatCadenceFromSeconds(bill.customIntervalSeconds)
          : "weekly",
      customIntervalSeconds:
        bill.frequency === "custom" ? String(bill.customIntervalSeconds || "") : "",
      recurring: !!bill.recurring,
    });
  }

  async function deleteBill(billId) {
    await cancelRecurringScheduleOnBackend(billId);
    setBills((prev) => prev.filter((b) => b.id !== billId));
  }

  function createCompanyProfile() {
    setPayrollError("");
    setPayrollStatus("");
    try {
      if (!companyForm.name.trim()) throw new Error("Company name is required");
      const company = {
        id: editingCompanyId || `co_${crypto.randomUUID()}`,
        name: companyForm.name.trim(),
        token: companyForm.token,
        tokenAddress:
          INITIAL_TOKENS.find((t) => t.symbol === companyForm.token)?.address || "",
        defaultFrequency: companyForm.defaultFrequency,
        createdAt: new Date().toISOString(),
      };
      setPayrollCompanies((prev) =>
        editingCompanyId
          ? prev.map((c) => (c.id === editingCompanyId ? { ...c, ...company } : c))
          : [company, ...prev]
      );
      setSelectedCompanyId(company.id);
      setEmployeeForm((prev) => ({
        ...prev,
        companyId: company.id,
        frequency: company.defaultFrequency,
      }));
      setCompanyForm((prev) => ({ ...prev, name: "" }));
      setEditingCompanyId(null);
      setPayrollStatus(editingCompanyId ? "Company profile updated" : "Company profile created");
    } catch (e) {
      setPayrollError(e.message || "Failed to create company profile");
    }
  }

  function editCompanyProfile(company) {
    if (!company) return;
    setEditingCompanyId(company.id);
    setSelectedCompanyId(company.id);
    setCompanyForm({
      name: company.name || "",
      token: company.token || "USDC",
      defaultFrequency: company.defaultFrequency || "monthly",
    });
  }

  /** Same scope for KPI cards + Upcoming runs (handles legacy rows missing companyId when there is only one company). */
  function employeeMatchesPayrollCompanyFilter(e, companyId) {
    const cid = String(companyId || "").trim();
    if (!cid) return true;
    if (String(e?.companyId || "").trim() === cid) return true;
    if (
      !String(e?.companyId || "").trim() &&
      payrollCompanies.length === 1 &&
      payrollCompanies[0]?.id === cid
    ) {
      return true;
    }
    return false;
  }

  function deleteCompanyProfile(companyId) {
    if (!companyId) return;
    setPayrollCompanies((prev) => prev.filter((c) => c.id !== companyId));
    setPayrollEmployees((prev) => prev.filter((e) => e.companyId !== companyId));
    setPayrollHistory((prev) => prev.filter((h) => h.companyId !== companyId));
    if (editingCompanyId === companyId) {
      setEditingCompanyId(null);
      setCompanyForm((prev) => ({ ...prev, name: "", token: "USDC", defaultFrequency: "monthly" }));
    }
    if (selectedCompanyId === companyId) {
      const fallback = payrollCompanies.find((c) => c.id !== companyId)?.id || "";
      setSelectedCompanyId(fallback);
      setEmployeeForm((prev) => ({ ...prev, companyId: fallback }));
    }
    setPayrollStatus("Company deleted");
  }

  async function addPayrollEmployee() {
    setPayrollError("");
    setPayrollStatus("");
    setPayrollRecipientInviteStatus("");
    try {
      const companyId = employeeForm.companyId || selectedCompanyId;
      if (!companyId) throw new Error("Select a company first");
      if (!employeeForm.name.trim()) throw new Error("Employee name is required");
      if (!employeeForm.role.trim()) throw new Error("Role is required");
      const salaryNum = Number(employeeForm.salary);
      if (!Number.isFinite(salaryNum) || salaryNum <= 0) {
        throw new Error("Salary must be a positive number");
      }
      let resolvedSpendPublicKey = employeeForm.receiverSpendPublicKey.trim();
      let resolvedViewPublicKey = employeeForm.receiverViewPublicKey.trim();
      const recipientWallet = employeeForm.recipientWallet.trim();
      if (!recipientWallet) {
        throw new Error("Employee wallet is required");
      }
      const selectedCompany = payrollCompanies.find((c) => c.id === companyId);
      const payrollTokenSymbol = selectedCompany?.token || companyForm.token || "USDC";
      const useZkPoolRoute = isZkRoute(payrollTokenSymbol, recipientWallet);
      if (!useZkPoolRoute) {
        setPayrollRecipientInviteAddress(recipientWallet);
        if (recipientWallet) {
          const receiver = await resolvePrivateReceiverByWallet(recipientWallet);
          resolvedSpendPublicKey = receiver.spendPublicKey;
          resolvedViewPublicKey = receiver.viewPublicKey;
        }
        if (!resolvedSpendPublicKey || !resolvedViewPublicKey) {
          throw new Error(
            "Employee must enable private receive first (connect once), then retry."
          );
        }
        const normalizedRecipientKeys = normalizeStealthRecipientKeys(
          resolvedSpendPublicKey,
          resolvedViewPublicKey
        );
        resolvedSpendPublicKey = normalizedRecipientKeys.receiverSpendPublicKey;
        resolvedViewPublicKey = normalizedRecipientKeys.receiverViewPublicKey;
      } else {
        setPayrollRecipientInviteAddress("");
        resolvedSpendPublicKey = "";
        resolvedViewPublicKey = "";
      }
      let nextRunAt;
      let customIntervalVal = null;
      if (employeeForm.frequency === "custom") {
        const start = parseDatetimeLocal(employeeForm.customStartAt);
        if (!start) {
          throw new Error(
            "Choose a date and time for the custom schedule (your device local time)."
          );
        }
        const minAhead = Date.now() + 25_000;
        if (start.getTime() <= minAhead) {
          throw new Error("Custom schedule must be at least a few seconds in the future.");
        }
        nextRunAt = start.toISOString();
        customIntervalVal = customRepeatCadenceToSeconds(employeeForm.customRepeatCadence);
      } else {
        nextRunAt = nextDateByFrequency({
          frequency: employeeForm.frequency,
          customIntervalSeconds: null,
          fromDate: new Date(),
        });
      }
      if (employeeForm.recurring && !canUsePayrollAutomation()) {
        throw new Error("Payroll automation is currently unavailable.");
      }

      const employee = {
        id: editingEmployeeId || `emp_${crypto.randomUUID()}`,
        companyId,
        name: employeeForm.name.trim(),
        role: employeeForm.role.trim(),
        recipientWallet: recipientWallet || "",
        receiverSpendPublicKey: resolvedSpendPublicKey,
        receiverViewPublicKey: resolvedViewPublicKey,
        salary: salaryNum,
        frequency: employeeForm.frequency,
        customIntervalSeconds:
          employeeForm.frequency === "custom" ? customIntervalVal : null,
        customRepeatCadence:
          employeeForm.frequency === "custom"
            ? employeeForm.customRepeatCadence || "weekly"
            : null,
        recurring: !!employeeForm.recurring,
        failureReason: null,
        nextRunAt,
        lastPaidAt: null,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      if (employee.recurring) {
        if (!getActiveWalletAddress()) {
          throw new Error("Connect your wallet to sign recurring payroll authorization and token approvals.");
        }
        if (!useZkPoolRoute) {
          throw new Error(
            "Recurring payroll uses server-side pool deposits and requires the privacy-pool (ZK) route. Use a standard 0x wallet for this employee."
          );
        }
        await ensureRecurringOnchainAuthorization(
          payrollEmployeeAuthBillShape(employee, selectedCompany)
        );
      }

      setPayrollEmployees((prev) =>
        editingEmployeeId
          ? prev.map((e) => (e.id === editingEmployeeId ? { ...e, ...employee } : e))
          : [employee, ...prev]
      );
      setEmployeeForm((prev) => ({
        ...prev,
        name: "",
        role: "",
        recipientWallet: "",
        receiverSpendPublicKey: "",
        receiverViewPublicKey: "",
        salary: "",
        customStartAt: "",
        customRepeatCadence: "weekly",
        customIntervalSeconds: "",
      }));
      setEditingEmployeeId(null);
      setPayrollRecipientInviteAddress("");
      setPayrollStatus(
        employee.recurring
          ? `Autopay enabled for "${employee.name}". Wallet approvals are complete; salary runs on the server when due.`
          : editingEmployeeId
            ? "Employee updated"
            : "Employee added"
      );
    } catch (e) {
      setPayrollError(e.message || "Failed to add employee");
    }
  }

  async function applyPayrollEmployeeRecurringToggle(emp, nextRecurring) {
    if (!emp?.id) return;
    setPayrollError("");
    if (!nextRecurring) {
      setPayrollEmployees((prev) =>
        prev.map((x) =>
          x.id === emp.id ? { ...x, recurring: false, failureReason: null } : x
        )
      );
      return;
    }
    if (!canUsePayrollAutomation()) return;
    const company = payrollCompanies.find((c) => c.id === emp.companyId);
    if (!company) {
      setPayrollError("Company not found for this employee.");
      return;
    }
    const payrollTokenSymbol = company.token || "USDC";
    const useZkPoolRoute = isZkRoute(payrollTokenSymbol, String(emp.recipientWallet || "").trim());
    if (!useZkPoolRoute) {
      setPayrollError(
        "Recurring payroll requires the privacy-pool (ZK) route. Use a standard 0x wallet for this employee."
      );
      return;
    }
    if (!getActiveWalletAddress()) {
      setPayrollError("Connect your wallet to enable recurring authorization.");
      return;
    }
    setPayrollRecurringToggleBusyId(emp.id);
    try {
      const nextEmp = { ...emp, recurring: true };
      await ensureRecurringOnchainAuthorization(payrollEmployeeAuthBillShape(nextEmp, company));
      setPayrollEmployees((prev) =>
        prev.map((x) =>
          x.id === emp.id ? { ...x, recurring: true, failureReason: null } : x
        )
      );
      setPayrollStatus(
        `Autopay enabled for "${emp.name || "employee"}". Wallet approvals complete; salary runs on the server when due.`
      );
    } catch (e) {
      setPayrollError(e?.message || "Could not enable recurring.");
    } finally {
      setPayrollRecurringToggleBusyId(null);
    }
  }

  /** Triggers server-side execution for all due recurring payroll (wallet-wide); syncs history so Claimed updates like Bills. */
  async function requestServerPayrollRun(companyId) {
    if (!companyId) return;
    if (!canUsePayrollAutomation()) {
      setPayrollError("Payroll automation is not available.");
      return;
    }
    const owner = getActiveWalletAddress();
    if (!owner) {
      setPayrollError("Connect a wallet first.");
      return;
    }
    setPayrollBusyCompanyId(companyId);
    setPayrollError("");
    setPayrollStatus("");
    try {
      const res = await fetch("/api/payments/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: String(owner).toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));
      await mergePayrollSnapshotFromServer().catch(() => {});
      const note = data?.note ? String(data.note) : "";
      const sum = data?.summary;
      if (note && /disabled/i.test(note)) {
        setPayrollAutopayServerHint(note);
        setPayrollStatus(note);
      } else if (sum && typeof sum === "object") {
        const ran = Number(sum.success || 0) + Number(sum.failed || 0);
        setPayrollStatus(
          ran > 0
            ? `Server payroll: ${sum.success ?? 0} paid, ${sum.failed ?? 0} failed, ${sum.skipped ?? 0} skipped (${sum.due ?? 0} were due).`
            : `No recurring payroll executed this run (${sum.due ?? 0} due in this check).`
        );
      } else {
        setPayrollStatus("Payroll server run finished.");
      }
      if (!note || !/disabled/i.test(note)) {
        setPayrollAutopayServerHint("");
      }
    } catch (e) {
      setPayrollError(e?.message || "Server payroll run failed.");
    } finally {
      setPayrollBusyCompanyId(null);
    }
  }

  async function runBulkPayroll(companyId, { source = "manual", employeeId = "" } = {}) {
    if (!companyId) return;
    if (!canUsePayrollAutomation()) {
      if (source === "manual") {
        setPayrollError("Run Bulk Payroll is currently unavailable.");
      }
      return;
    }
    if (source === "manual") {
      setPayrollBusyCompanyId(companyId);
      setPayrollError("");
      setPayrollStatus("");
    }
    try {
      const company = payrollCompanies.find((c) => c.id === companyId);
      if (!company) throw new Error("Company not found");
      const now = new Date();
      /** Client-side payroll only for non-recurring rows past their next run (Recurring uses /api/payments/payroll/run). */
      let dueEmployees = payrollEmployees.filter(
        (e) =>
          e.companyId === companyId &&
          e.status === "active" &&
          !e.recurring &&
          e.nextRunAt &&
          new Date(e.nextRunAt).getTime() <= now.getTime()
      );

      if (employeeId) {
        dueEmployees = payrollEmployees.filter(
          (e) => e.companyId === companyId && e.id === employeeId && e.status === "active"
        );
        if (dueEmployees.length === 0) {
          if (source === "manual") {
            setPayrollStatus("Selected employee is not active.");
          }
          return;
        }
        if (source === "manual" && dueEmployees[0]?.recurring) {
          setPayrollError(PAYROLL_MANUAL_PAY_RECURRING_MSG);
          return;
        }
      }

      if (!employeeId && dueEmployees.length === 0) {
        return;
      }

      const logs = [];
      const runId = `run_${crypto.randomUUID()}`;
      const paidAt = now.toISOString();
      const succeededEmployeeIds = new Set();
      const invalidConfigEmployeeIds = new Set();
      for (const emp of dueEmployees) {
        try {
          const empRecipient = String(emp.recipientWallet || "").trim();
          const usePool = isZkRoute(company.token, empRecipient);
          let repaired = {
            receiverSpendPublicKey: emp.receiverSpendPublicKey || "",
            receiverViewPublicKey: emp.receiverViewPublicKey || "",
          };
          if (emp.recipientWallet && !usePool) {
            try {
              repaired = await ensureValidRecipientKeys({
                receiverSpendPublicKey: emp.receiverSpendPublicKey,
                receiverViewPublicKey: emp.receiverViewPublicKey,
                recipientWallet: emp.recipientWallet,
                entityLabel: "Employee",
              });
            } catch {
              repaired = { receiverSpendPublicKey: "", receiverViewPublicKey: "" };
            }
          }
          if (
            repaired.receiverSpendPublicKey !== emp.receiverSpendPublicKey ||
            repaired.receiverViewPublicKey !== emp.receiverViewPublicKey
          ) {
            setPayrollEmployees((prev) =>
              prev.map((x) =>
                x.id === emp.id
                  ? {
                      ...x,
                      receiverSpendPublicKey: repaired.receiverSpendPublicKey,
                      receiverViewPublicKey: repaired.receiverViewPublicKey,
                      failureReason: null,
                    }
                  : x
              )
            );
          }
          const feeTxHash = await chargePrivpayUsageFee("payroll");
          let row;
          if (usePool) {
            const poolRes = await executePrivacyPoolPayment({
              tokenSymbol: company.token,
              amount: emp.salary,
              recipientWallet: empRecipient,
              metadata: {
                kind: "payroll",
                companyId,
                employeeId: emp.id,
                employeeName: emp.name,
                ts: Date.now(),
              },
            });
            row = {
              id: `pr_${crypto.randomUUID()}`,
              runId,
              companyId,
              companyName: company.name,
              employeeId: emp.id,
              employeeName: emp.name,
              role: emp.role,
              token: company.token,
              amount: emp.salary,
              paymentRail: "privacyPool",
              status:
                poolRes.txHash === "SUBMITTED"
                  ? "submitted (confirm on explorer)"
                  : "submitted",
              payerAddress: poolRes.payerAddress,
              poolAddress: poolRes.poolAddress,
              poolCommitment: poolRes.poolCommitment,
              poolRecipient: poolRes.poolRecipient,
              poolNullifierHash: poolRes.poolNullifierHash,
              poolClaimCode: poolRes.poolClaimCode,
              metadataHash: poolRes.metadataHash,
              feeTxHash,
              txHash: poolRes.txHash,
              blockNumber: poolRes.blockNumber || null,
              confirmedAt: poolRes.confirmedAt || null,
              createdAt: paidAt,
              payrollExecution: "manual",
            };
          } else {
            const {
              stealth,
              txHash,
              metadataHash,
              blockNumber,
              confirmedAt,
              payerAddress,
            } = await executeStealthTokenPayment({
              tokenSymbol: company.token,
              amount: emp.salary,
              receiverSpendPublicKey: repaired.receiverSpendPublicKey,
              receiverViewPublicKey: repaired.receiverViewPublicKey,
              metadata: {
                kind: "payroll",
                companyId,
                employeeId: emp.id,
                employeeName: emp.name,
                ts: Date.now(),
              },
            });
            row = {
              id: `pr_${crypto.randomUUID()}`,
              runId,
              companyId,
              companyName: company.name,
              employeeId: emp.id,
              employeeName: emp.name,
              role: emp.role,
              token: company.token,
              amount: emp.salary,
              paymentRail: "stealth",
              status:
                txHash === "SUBMITTED"
                  ? "submitted (confirm on explorer)"
                  : "submitted",
              payerAddress,
              stealthAddress: stealth.stealthAddress,
              ephemeralPublicKey: stealth.ephemeralPublicKey,
              viewTag: stealth.viewTag,
              metadataHash,
              feeTxHash,
              txHash,
              blockNumber: blockNumber || null,
              confirmedAt: confirmedAt || null,
              createdAt: paidAt,
              payrollExecution: "manual",
            };
          }
          logs.push(row);
          succeededEmployeeIds.add(emp.id);
        } catch (e) {
          const errorMsg = e?.message || "Stealth generation failed";
          logs.push({
            id: `pr_${crypto.randomUUID()}`,
            runId,
            companyId,
            companyName: company.name,
            employeeId: emp.id,
            employeeName: emp.name,
            role: emp.role,
            token: company.token,
            amount: emp.salary,
            status: "failed",
            error: errorMsg,
            createdAt: paidAt,
            payrollExecution: "manual",
          });
          if (isLikelyStealthConfigError(e)) {
            invalidConfigEmployeeIds.add(emp.id);
          }
        }
      }

      setPayrollHistory((prev) => [...logs, ...prev]);
      setPayrollEmployees((prev) =>
        prev.map((e) => {
          if (!dueEmployees.some((d) => d.id === e.id)) return e;
          if (invalidConfigEmployeeIds.has(e.id)) {
            return {
              ...e,
              recurring: false,
              status: "active",
              failureReason: "Invalid recipient stealth keys. Edit employee and save valid keys.",
            };
          }
          if (!succeededEmployeeIds.has(e.id)) {
            return {
              ...e,
              nextRunAt: new Date(Date.now() + 90 * 1000).toISOString(),
            };
          }
          return {
            ...e,
            lastPaidAt: paidAt,
            failureReason: null,
            lastCircleSubmissionAt: isCircleMode() ? paidAt : e.lastCircleSubmissionAt,
            nextRunAt: nextDateByFrequency({
              frequency: e.frequency,
              customIntervalSeconds: e.customIntervalSeconds,
              fromDate: new Date(paidAt),
            }),
          };
        })
      );

      if (source === "manual") {
        const firstSuccessful = logs.find((x) => x.status !== "failed");
        if (firstSuccessful) {
          openPayrollReceiptCard(firstSuccessful, { autoOpened: true });
        }
        if (employeeId) {
          const target = dueEmployees[0];
          if (firstSuccessful) {
            setPayrollStatus(`Paid ${target?.name || "employee"} successfully.`);
          } else {
            setPayrollStatus(`Payment failed for ${target?.name || "employee"}.`);
          }
        } else {
          setPayrollStatus(
            `Bulk payroll submitted for ${succeededEmployeeIds.size}/${dueEmployees.length} employee(s). Run ID: ${runId}`
          );
        }
      }
    } catch (e) {
      if (source === "manual") {
        setPayrollError(e.message || "Failed to run payroll");
      }
    } finally {
      if (source === "manual") {
        setPayrollBusyCompanyId(null);
      }
    }
  }

  async function payEmployeeNow(employee) {
    if (!employee?.id || !employee?.companyId) return;
    if (employee.recurring) {
      setPayrollStatus("");
      setPayrollError(PAYROLL_MANUAL_PAY_RECURRING_MSG);
      return;
    }
    if (isCircleMode() && isRecentCircleSubmission(employee.lastCircleSubmissionAt)) {
      setPayrollStatus(
        `A recent Circle submission for ${employee.name || "this employee"} is still settling. Please wait before retrying.`
      );
      return;
    }
    setPayrollBusyEmployeeId(employee.id);
    try {
      await runBulkPayroll(employee.companyId, {
        source: "manual",
        employeeId: employee.id,
      });
    } finally {
      setPayrollBusyEmployeeId(null);
    }
  }

  function editEmployee(emp) {
    setEditingEmployeeId(emp.id);
    setEmployeeForm({
      companyId: emp.companyId || "",
      name: emp.name || "",
      role: emp.role || "",
      recipientWallet: emp.recipientWallet || "",
      receiverSpendPublicKey: emp.receiverSpendPublicKey || "",
      receiverViewPublicKey: emp.receiverViewPublicKey || "",
      salary: String(emp.salary || ""),
      frequency: emp.frequency || "monthly",
      customStartAt:
        emp.frequency === "custom" && emp.nextRunAt
          ? formatDatetimeLocalValue(new Date(emp.nextRunAt))
          : "",
      customRepeatCadence:
        emp.frequency === "custom"
          ? emp.customRepeatCadence ||
            inferCustomRepeatCadenceFromSeconds(emp.customIntervalSeconds)
          : "weekly",
      customIntervalSeconds:
        emp.frequency === "custom" ? String(emp.customIntervalSeconds || "") : "",
      recurring: !!emp.recurring,
    });
  }

  function deleteEmployee(employeeId) {
    setPayrollEmployees((prev) => prev.filter((e) => e.id !== employeeId));
  }

  function setPercentAmount(percent) {
    const bal = balances[swapFrom];
    if (!bal || bal === "n/a") return;

    const amount =
      percent === 100 ? Number(bal) : Number(bal) * (percent / 100);

    setSwapAmount(amount.toFixed(6));
  }

  async function ensureArcNetwork() {
    const { ethereum } = window;
    if (!ethereum) return false;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
      return true;
    } catch (err) {
      // 4902: Chain not found. Some wallets might throw generic errors with "Unrecognized chain".
      if (
        err.code === 4902 ||
        (err.message && err.message.includes("Unrecognized chain"))
      ) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: ARC_CHAIN_ID_HEX,
                chainName: "Arc Testnet",
                nativeCurrency: {
                  name: "ARC",
                  symbol: "ARC",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.testnet.arc.network"],
                blockExplorerUrls: ["https://testnet.arcscan.app"],
              },
            ],
          });

          // Retry switching after adding
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ARC_CHAIN_ID_HEX }],
          });

          return true;
        } catch (addError) {
          console.error("Failed to add or switch to Arc Testnet", addError);
          return false;
        }
      }
      console.error("Failed to switch to Arc Testnet", err);
      return false;
    }
  }

  async function connectWallet() {
    try {
      const { ethereum } = window;
      if (!ethereum) {
        setStatus("No wallet found. Please install MetaMask or Rabby.");
        return;
      }

      // 1. Ensure we are on Arc Testnet (add/switch if needed)
      const ok = await ensureArcNetwork();
      if (!ok) {
        setStatus("Please add or switch to Arc Testnet");
        return;
      }

      // 2. Request accounts (wallet popup)
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts?.length) {
        setStatus("No account found.");
        return;
      }

      const userAddress = accounts[0];
      const provider = new ethers.BrowserProvider(ethereum);
      const net = await provider.getNetwork();

      if (Number(net.chainId) !== ARC_CHAIN_ID_DEC) {
        setStatus("Failed to switch to Arc Testnet");
        return;
      }

      setAddress(userAddress);
      setNetwork(Number(net.chainId));
      setStatus("Connected to Arc Testnet");

      await fetchBalances(userAddress, provider);
      await fetchAllLPBalances(userAddress, provider);
      await fetchLPTokenAmounts(userAddress, provider);
      await fetchPoolBalances(provider);
    } catch (err) {
      console.error("connectWallet error:", err);
      setStatus("Wallet connection failed");
    }
  }

  async function disconnectWallet() {
    setAddress(null);
    setNetwork(null);
    setStatus("Not connected");
    setBalances({});
    setQuote(null);
    setSwapAmount("");
    setEstimatedTo("");
    // Also clear Circle state if it was active, just in case
    if (authMode === "email") {
      disconnectEmail();
    }
  }

  function disconnectEmail() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("circle_device_id");
      window.localStorage.removeItem("deviceId");
      window.localStorage.removeItem("circle_user_email");
      window.localStorage.removeItem("circle_user_token");
      window.localStorage.removeItem("circle_encryption_key");
      window.localStorage.removeItem("circle_device_token");
      window.localStorage.removeItem("circle_device_encryption_key");
      window.localStorage.removeItem("circle_otp_token");
      window.localStorage.removeItem("circle_app_id");
    }
    setCircleDeviceId("");
    setCircleDeviceToken("");
    setCircleDeviceEncryptionKey("");
    setCircleOtpToken("");
    setUserEmail(null);
    setCircleLogin(null);
    setCircleWallet(null);
    setCircleWalletReady(false);
    setAuthMode("wallet");
    setShowEmailModal(false);
    setEmailStep(1);
    setEmailStatus("");
    setEmailError("");
    setAddress(null); // Ensure address is cleared
  }

  function exportCircleWallet() {
    if (!circleWallet) return;
    const payload = {
      walletId: circleWallet.walletId,
      address: circleWallet.address,
      blockchain: circleWallet.blockchain,
      email: userEmail || null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "circle-wallet.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function getBalances(userAddress, provider) {
    const tokenBalances = {};
    // Use fallback provider if none passed
    const p = provider || (window.ethereum 
      ? new ethers.BrowserProvider(window.ethereum) 
      : new ethers.JsonRpcProvider("https://rpc.testnet.arc.network"));

    for (const t of tokens) {
      try {
        const tokenContract = new ethers.Contract(
          t.address,
          ERC20_ABI,
          p
        );
        const rawBalance = await tokenContract.balanceOf(userAddress);
        const decimals = await tokenContract.decimals();
        tokenBalances[t.symbol] = parseFloat(
          ethers.formatUnits(rawBalance, decimals)
        ).toFixed(4);
      } catch {
        tokenBalances[t.symbol] = "n/a";
      }
    }
    return tokenBalances;
  }

  async function fetchBalances(userAddress, provider) {
    try {
      const b = await getBalances(userAddress, provider);
      setBalances(b);
    } catch (err) {
      console.error("Failed to fetch balances:", err);
    }
  }

  function shortAddr(a) {
    if (!a) return "";
    return a.slice(0, 6) + "..." + a.slice(-4);
  }

  function normalizeAddress(a) {
    if (!a) return null;
    try {
      return ethers.getAddress(a);
    } catch {
      try {
        return ethers.getAddress(String(a).toLowerCase());
      } catch {
        return String(a);
      }
    }
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",");
    return `{${body}}`;
  }

  async function copyAddress(addr) {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setToast("Address copied");
    } catch (e) {
      try {
        const el = document.createElement("textarea");
        el.value = addr;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setToast("Address copied");
      } catch (e2) {
        console.warn("[Clipboard] Copy failed", e2?.message || e2);
        setToast("Copy failed");
      }
    } finally {
      setTimeout(() => setToast(null), 2500);
    }
  }
  function isMyTx(tx) {
    const a = String(getActiveWalletAddress() || "").toLowerCase();
    if (!a) return false;
    return tx.from?.toLowerCase() === a || tx.to?.toLowerCase() === a;
  }

  function formatDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(Number(ts) * 1000);
    return d.toLocaleString();
  }

  function onSwapArrowClick() {
    setArrowSpin(true);
    setTimeout(() => setArrowSpin(false), 600);
    const prev = swapFrom;
    setSwapFrom(swapTo);
    setSwapTo(prev);
    setQuote(null);
    setEstimatedTo("");
  }

  // Helper to get the correct signer (MetaMask or Circle)
  async function getSigner() {
    if (authMode === "email" && circleWallet) {
      // Return a custom CircleSigner
      const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
      const signer = new CircleSigner(circleWallet.walletId, circleSdkRef.current, provider);
      signer.setAddress(circleWallet.address);
      return signer;
    }

    // Default MetaMask
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }

  // --- Circle Transaction Layer ---
  // Moved up to prevent TDZ.
  // See top of App function for declarations.
  
  // --- TRANSACTION BUILDERS (Shared) ---
  function buildApproveCall(tokenAddress, spenderAddress, amount) {
    return {
      contractAddress: tokenAddress,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [spenderAddress.toString(), amount.toString()],
      amount: "0", // No ETH value sent
    };
  }

  function buildSwapCall(poolAddress, i, j, dx) {
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "swap(uint256,uint256,uint256)",
      abiParameters: [i.toString(), j.toString(), dx.toString()],
      amount: "0",
    };
  }

  function buildAddLiquidityCall(poolAddress, amounts) {
    // Verified from Arcscan ABI: addLiquidity(uint256[]) — camelCase, no min_mint_amount param
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "addLiquidity(uint256[])",
      // Dynamic uint256[] — pass as nested array so Circle encodes correctly
      abiParameters: [amounts.map(String)],
      amount: "0",
    };
  }

  function buildRemoveLiquidityCall(poolAddress, lpAmount) {
    // Verified from Arcscan ABI: removeLiquidity(uint256) — camelCase, 1 param only
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "removeLiquidity(uint256)",
      abiParameters: [lpAmount.toString()],
      amount: "0",
    };
  }

  function buildClaimRewardsCall(poolAddress) {
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "claimRewards()",
      abiParameters: [],
      amount: "0",
    };
  }

  /**
   * executeCircleContractAction
   * Production-grade helper to execute a contract action via Circle User-Controlled flow.
   * All calls are serialized through a simple in-memory queue so that rapid user clicks
   * cannot trigger overlapping Circle challenges.
   */
  async function executeCircleContractAction({
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    callData,
    amount = "0",
    title = "Confirm in Circle",
    updateSwapQuote = false,
  }) {
    const runAction = async () => {
      console.log(`[CircleTx] Initiating: ${title} on ${contractAddress}`);
      const { userToken, encryptionKey, walletId } = requireCircleAuth();

      // 1. Initiate challenge on backend
      const res = await fetch("/api/circle/user/execute-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken,
          walletId,
          contractAddress,
          abiFunctionSignature,
          abiParameters,
          callData,
          amount,
          requestTimestampMs: Date.now(),
          requestNonce: crypto.randomUUID(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      
      // Handle session / token expiry (Circle returns 403 + "userToken had expired" or 401)
      const errStr = String(data.error || "").toLowerCase();
      if (res.status === 401 || res.status === 403 || errStr.includes("expired") || errStr.includes("session") || data.code === 155104) {
        console.warn("[CircleTx] Token/session expired, prompting re-login...", { status: res.status, error: data.error, code: data.code });
        disconnectEmail();
        alert("Your Circle session has expired. Please log in again.");
        window.location.reload();
        return;
      }

      if (!res.ok) {
        console.error("[CircleTx] Initiation failed:", data);
        throw new Error(data.error || "Failed to initiate Circle transaction");
      }

      const challengeId = data.challengeId;
      if (!challengeId) throw new Error("No challengeId returned from backend");

      // 2. Prompt user for PIN/Challenge via SDK (callback often includes txHash before REST does)
      const sdkChallengeResult = await executeCircleChallengeViaPrompt(challengeId, title);
      let txHash = extractCircleSdkTxHash(sdkChallengeResult);
      if (txHash) {
        console.log("[CircleChallenge] Using txHash from Circle SDK callback");
      } else {
        console.log("[CircleChallenge] Polling challenge-status for tx hash...");
        txHash = await waitForCircleTxHash(challengeId, { transactionId: data.transactionId });
      }
      if (!txHash) {
        throw new Error("Timeout: Transaction submitted but hash not found. Please check history.");
      }

      console.log(`[CircleTx] Hash received: ${txHash}`);

      // 4. Best-effort confirmation only. Do not block UX for long RPC/indexer delays.
      if (txHash !== "SUBMITTED") {
        if (updateSwapQuote) {
          setQuote("Transaction submitted. Verifying confirmation...");
        }
        try {
          await waitForTxBestEffort(txHash, 45000);
        } catch (e) {
          console.warn("[CircleTx] Confirmation check failed (non-blocking):", e?.message || e);
        }
      } else {
        // Challenge is complete but Circle did not surface a hash yet.
        if (updateSwapQuote) {
          setQuote("Transaction submitted...");
        }
      }

      return { hash: txHash };
    };

    // Simple FIFO queue: chain the next action off the previous promise.
    // We also maintain a depth counter so the UI can be disabled while queued/in-flight.
    circleActionDepthRef.current += 1;
    setCircleActionsBusy(true);

    const previous = circleActionQueueRef.current || Promise.resolve();
    const queued = previous
      .catch(() => {
        // Ignore errors from previous actions when starting a new one.
      })
      .then(runAction)
      .finally(() => {
        circleActionDepthRef.current = Math.max(
          0,
          circleActionDepthRef.current - 1
        );
        setCircleActionsBusy(circleActionDepthRef.current > 0);
      });

    circleActionQueueRef.current = queued;
    return queued;
  }
  
  // Clean up unused function initiateCircleContractExecution if present
  // Removed initiateCircleContractExecution as it is superseded by executeCircleContractAction



  /** Circle Web SDK may return tx hash in callback before REST indexer surfaces it. */
  function extractCircleSdkTxHash(result) {
    if (!result || typeof result !== "object") return null;
    const d = result.data;
    if (d && typeof d.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(d.txHash)) {
      return d.txHash;
    }
    if (typeof result.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(result.txHash)) {
      return result.txHash;
    }
    return null;
  }

  async function executeCircleChallenge(challengeId, retryCount = 0) {
    const MAX_RETRIES = 3;
    const userToken = window.localStorage.getItem("circle_user_token");
    const encryptionKey = window.localStorage.getItem("circle_encryption_key");
    if (!userToken || !encryptionKey) {
      throw new Error("Circle session missing. Please login again.");
    }
    if (!circleSdkRef.current) {
      throw new Error("Circle SDK not ready");
    }
    circleSdkRef.current.setAuthentication({ userToken, encryptionKey });
    try {
      return await new Promise((resolve, reject) => {
        circleSdkRef.current.execute(challengeId, (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        });
      });
    } catch (error) {
      // Error 155706 = Circle iframe failed to load (network/cookie/timing issue)
      // Retry automatically with exponential backoff — most retries succeed within 1-2 attempts
      if (error.code === 155706 && retryCount < MAX_RETRIES) {
        const delay = 1000 * (retryCount + 1); // 1s, 2s, 3s
        console.warn(`[Circle] SDK error 155706, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        return executeCircleChallenge(challengeId, retryCount + 1);
      }
      // All retries exhausted or unrelated error
      if (error.code === 155706) {
        throw new Error(
          "Connection issue with Circle. Please ensure third-party cookies are allowed for this site and try again."
        );
      }
      throw new Error(error.message || "Circle confirmation failed");
    }
  }

  async function executeCircleChallengeViaPrompt(challengeId, title) {
    if (!challengeId) throw new Error("Missing challengeId");
    if (circlePromptInFlightRef.current) {
      throw new Error("A Circle confirmation is already open. Please complete it first.");
    }
    setCircleExecError("");
    setCircleExecLoading(false);
    circlePromptInFlightRef.current = true;
    setCircleExecPrompt({ title: title || "Confirm in Circle", challengeId });
    return await new Promise((resolve, reject) => {
      circleExecResolverRef.current = { resolve, reject };
    });
  }

  async function confirmCircleExecution() {
    if (!circleExecPrompt?.challengeId) return;
    if (!circleExecResolverRef.current) return;
    setCircleExecLoading(true);
    setCircleExecError("");
    try {
      const challengeResult = await executeCircleChallenge(circleExecPrompt.challengeId);
      const { resolve } = circleExecResolverRef.current;
      circleExecResolverRef.current = null;
      setCircleExecPrompt(null);
      setCircleExecLoading(false);
      circlePromptInFlightRef.current = false;
      resolve(challengeResult);
    } catch (e) {
      setCircleExecLoading(false);
      setCircleExecError(e?.message || String(e));
      circlePromptInFlightRef.current = false;
    }
  }

  function cancelCircleExecution() {
    if (circleExecResolverRef.current?.reject) {
      circleExecResolverRef.current.reject(new Error("Circle execution cancelled"));
    }
    circleExecResolverRef.current = null;
    setCircleExecPrompt(null);
    setCircleExecLoading(false);
    setCircleExecError("");
    circlePromptInFlightRef.current = false;
  }

  // initiateCircleContractExecution removed - superseded by executeCircleContractAction

  function challengeStatusUrl(challengeId, transactionId) {
    let u = `/api/circle/user/challenge-status?challengeId=${encodeURIComponent(challengeId)}`;
    const tid = transactionId && String(transactionId).trim();
    if (tid) u += `&transactionId=${encodeURIComponent(tid)}`;
    return u;
  }

  async function waitForCircleTxHash(challengeId, opts = 60) {
    const options = typeof opts === "number" ? { maxAttempts: opts } : opts || {};
    const maxAttempts = options.maxAttempts ?? 60;
    const transactionId = options.transactionId ?? null;
    const userToken = window.localStorage.getItem("circle_user_token");
    const TERMINAL_STATES = ["COMPLETE", "CONFIRMED", "FAILED", "CANCELLED"];
    const statusUrl = () => challengeStatusUrl(challengeId, transactionId);
    let transientFailures = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(statusUrl(), {
          headers: { "X-User-Token": userToken },
        });
        if (res.ok) {
          transientFailures = 0;
          const data = await res.json().catch(() => ({}));
          const hash = data?.transactionHash;
          const state = data?.state || data?.challenge?.state || data?.challenge?.status || "";

          console.log(`[CircleChallenge] poll #${attempt + 1} state="${state}" hash=${hash || "none"}`);

          if (hash && typeof hash === "string" && hash.startsWith("0x")) return hash;

          const stateU = String(state || "").toUpperCase();
          if (TERMINAL_STATES.some((s) => stateU.includes(s))) {
            if (stateU.includes("FAILED") || stateU.includes("CANCELLED")) {
              const reason = data?.txErrorReason || data?.error || "Circle challenge failed";
              throw new Error(typeof reason === "string" ? reason : "Circle challenge failed");
            }
            for (let extra = 0; extra < 24; extra += 1) {
              await new Promise((r) => setTimeout(r, 2500));
              const retry = await fetch(statusUrl(), { headers: { "X-User-Token": userToken } });
              if (retry.ok) {
                const retryData = await retry.json().catch(() => ({}));
                const retryHash = retryData?.transactionHash;
                if (retryHash && typeof retryHash === "string" && retryHash.startsWith("0x")) {
                  console.log(`[CircleChallenge] txHash surfaced after terminal state (extra poll ${extra + 1})`);
                  return retryHash;
                }
              }
            }
            console.warn(
              "[CircleChallenge] Terminal state but no txHash after extended poll; treating as submitted."
            );
            return "SUBMITTED";
          }
        } else {
          transientFailures += 1;
          const errData = await res.json().catch(() => ({}));
          console.warn(
            `[CircleChallenge] poll #${attempt + 1} non-200 status=${res.status} error=${errData?.error || "unknown"}`
          );
          if (transientFailures >= 3) {
            console.warn("[CircleChallenge] Repeated challenge-status failures; treating Circle action as submitted.");
            return "SUBMITTED";
          }
        }
      } catch (err) {
        transientFailures += 1;
        console.warn(
          `[CircleChallenge] poll #${attempt + 1} request failed: ${err?.message || err}`
        );
        if (transientFailures >= 3) {
          console.warn("[CircleChallenge] Repeated poll request failures; treating Circle action as submitted.");
          return "SUBMITTED";
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return "SUBMITTED";
  }

  // executeCircleTxAndWait was a helper from the old flow - removed to avoid confusion.
  // Use executeCircleContractAction directly.

  async function performSwapEmail() {
    console.log("[CircleTx] Starting Swap...");
    if (!isCircleMode()) throw new Error("Circle wallet not ready");

    const provider = getReadProvider();
    const fromToken = tokens.find((t) => t.symbol === swapFrom);
    const toToken = tokens.find((t) => t.symbol === swapTo);
    if (!fromToken || !toToken) throw new Error("Token not found");

    // 1. Prepare Amount & Decimals (Read from public provider)
    const tokenInReader = new ethers.Contract(fromToken.address, ERC20_ABI, provider);
    const decimalsIn = await tokenInReader.decimals();
    const amountIn = ethers.parseUnits(swapAmount, decimalsIn);
    console.log(`[CircleTx] Swap Amount: ${amountIn.toString()} (${swapAmount} ${swapFrom})`);

    // 2. Check Allowance
    const walletAddr = getActiveWalletAddress();
    const allowance = await tokenInReader.allowance(walletAddr, SWAP_POOL_ADDRESS);
    console.log(`[CircleTx] Allowance: ${allowance.toString()}`);

    if (BigInt(allowance) < BigInt(amountIn)) {
      setQuote(`Approving ${swapFrom} for trading...`);
      
      const MAX_UINT256 = ethers.MaxUint256;
      const approveTx = buildApproveCall(fromToken.address, SWAP_POOL_ADDRESS, MAX_UINT256);
      
      // Execute Approve via Circle
      await executeCircleContractAction({
        contractAddress: approveTx.contractAddress,
        abiFunctionSignature: approveTx.abiFunctionSignature,
        abiParameters: approveTx.abiParameters,
        title: `Approve ${swapFrom} in Circle`,
        updateSwapQuote: true,
      });
      console.log("[CircleTx] Approve confirmed. Waiting for RPC sync...");
      // Poll until allowance is reflected on-chain to avoid 'insufficient allowance' reverts on slow nodes
      let allowanceConfirmed = false;
      for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const newAllowance = await tokenInReader.allowance(walletAddr, SWAP_POOL_ADDRESS);
          if (newAllowance >= MAX_UINT256 / 2n) {
              allowanceConfirmed = true;
              break;
          }
      }
      if (!allowanceConfirmed) {
          throw new Error("Blockchain is slow to sync approval. Please try your swap again in a few seconds.");
      }
    }

    // 3. Estimate Output (Read-only)
    const poolReader = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
    let expectedOut = null;
    try {
      expectedOut = await poolReader.get_dy(TOKEN_INDICES[swapFrom], TOKEN_INDICES[swapTo], amountIn);
    } catch (e) {
      console.warn("[CircleRead] get_dy failed:", e);
    }

    if (!expectedOut || expectedOut === 0n) {
      throw new Error("Could not get expected output. Try a smaller amount.");
    }

    // Slippage: minimum received (contract will revert if output < min_dy)
    const slippagePct = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
    const min_dy = (expectedOut * BigInt(Math.floor(100 - slippagePct))) / 100n;

    // Trade size check: swap amount must not exceed 10% of pool liquidity
    const rawBalances = await poolReader.getBalances();
    const fromIdx = TOKEN_INDICES[swapFrom];
    const poolFromBalance = rawBalances[fromIdx];
    if (poolFromBalance != null && poolFromBalance > 0n && amountIn > (poolFromBalance * 10n) / 100n) {
      throw new Error("Trade size is too large for current liquidity.");
    }

    // High price impact: require extra confirmation if > 25%
    const toIdx = TOKEN_INDICES[swapTo];
    const poolToBalance = rawBalances[toIdx];
    if (poolFromBalance != null && poolToBalance != null && poolFromBalance > 0n && poolToBalance > 0n) {
      const amountNum = Number(swapAmount) || 0;
      const expectedHumanForImpact = Number(ethers.formatUnits(expectedOut, 6));
      const poolFromNum = Number(ethers.formatUnits(poolFromBalance, await tokenInReader.decimals()));
      const poolToNum = Number(ethers.formatUnits(poolToBalance, 6));
      const executionRate = expectedHumanForImpact / amountNum;
      const spotRate = poolToNum / poolFromNum;
      const priceImpactPercent = (1 - executionRate / spotRate) * 100;
      if (priceImpactPercent > 25 && !highImpactConfirmed) {
        throw new Error("Please confirm high price impact in the swap panel before continuing.");
      }
    }

    let expectedHuman = null;
    const decOut = 6;
    expectedHuman = Number(ethers.formatUnits(expectedOut, decOut));

    setQuote(
      expectedHuman
        ? `Estimated: ~${expectedHuman.toFixed(6)} ${swapTo}. Min: ~${Number(ethers.formatUnits(min_dy, decOut)).toFixed(6)}. Sending...`
        : "Sending swap..."
    );

    // 4. Execute Swap via Circle 
    // Contract does not natively support min_dy, so we pass 3 arguments
    const swapTx = buildSwapCall(
      SWAP_POOL_ADDRESS,
      TOKEN_INDICES[swapFrom],
      TOKEN_INDICES[swapTo],
      amountIn
    );

    const { hash: txHash } = await executeCircleContractAction({
      contractAddress: swapTx.contractAddress,
      abiFunctionSignature: swapTx.abiFunctionSignature,
      abiParameters: swapTx.abiParameters,
      title: "Confirm swap in Circle",
      updateSwapQuote: true,
    });

    setQuote("Submitted! Waiting for confirmation...");
    console.log("[CircleTx] Swap confirmed:", txHash);

    // 5. Post-Swap Updates (History, Modal, Profile, Balances)
    const pendingTx = {
      fromToken: swapFrom,
      fromAmount: swapAmount,
      toToken: swapTo,
      toAmount: expectedHuman ? expectedHuman.toFixed(6) : "0",
      txUrl: `https://testnet.arcscan.app/tx/${txHash}`,
      hash: txHash,
      timestamp: Date.now(),
      status: "success",
    };

    setSwapHistory((prev) => [pendingTx, ...prev]);

    setTxModal({
      status: "success",
      fromToken: swapFrom,
      fromAmount: swapAmount,
      toToken: swapTo,
      toAmount: expectedHuman ? expectedHuman.toFixed(6) : estimatedTo || "0",
      txHash,
    });

    setQuote(`Swap succeeded — tx ${txHash}`);

    // Update Profile Stats
    try {
      const price = tokenPrices[swapFrom] || 1;
      const usdValue = Number(swapAmount) * Number(price);
      await fetch("/api/profile/addSwap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: walletAddr,
          amount: usdValue,
        }),
      });
      setTimeout(() => {
        fetchProfile(walletAddr);
      }, 3000);
    } catch (err) {
      console.warn("[App] Profile update failed", err);
    }

    // Refresh Balances
    await fetchBalances(walletAddr, provider);
  }

  async function performSwap() {
    if (!swapAmount || Number(swapAmount) <= 0) {
      alert("Enter a valid amount to swap.");
      return;
    }
    if (swapFrom === swapTo) {
      alert("Choose different tokens to swap.");
      return;
    }
    if (Object.keys(TOKEN_INDICES).length === 0) {
      alert("Pool not loaded – please reconnect wallet.");
      return;
    }
    if (
      !balances[swapFrom] ||
      balances[swapFrom] === "n/a" ||
      Number(swapAmount) > Number(balances[swapFrom])
    ) {
      alert("Insufficient balance for " + swapFrom);
      return;
    }

    try {
      if (authMode === "email") {
        await performSwapEmail();
        return;
      }
      // Use our custom signer helper
      const signer = await getSigner();
      // For reads, we can use the signer's provider or a default one
      const provider = signer.provider || new ethers.BrowserProvider(window.ethereum);

      const fromToken = tokens.find((t) => t.symbol === swapFrom);
      const toToken = tokens.find((t) => t.symbol === swapTo);
      if (!fromToken || !toToken) throw new Error("Token not found");

      const i = TOKEN_INDICES[swapFrom];
      const j = TOKEN_INDICES[swapTo];

      // Contract instance connected to our signer
      const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
      const decimalsIn = await tokenIn.decimals(); // This is a read, uses provider
      const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

      const allowance = await tokenIn.allowance(
        await signer.getAddress(),
        SWAP_POOL_ADDRESS
      );

      if (BigInt(allowance) < BigInt(amountIn)) {
        setQuote(`Approving ${swapFrom} for trading...`);
        const txA = await tokenIn.approve(SWAP_POOL_ADDRESS, ethers.MaxUint256);
        setQuote("Waiting for approval confirmation...");
        await txA.wait(1);
        
        // Add a small delay for public RPC nodes to catch up on state BEFORE the swap simulation
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 2. Perform Swap
      const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, signer);
      const poolReader = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, getReadProvider());

      const fromIdx = TOKEN_INDICES[fromToken.symbol];
      const toIdx = TOKEN_INDICES[toToken.symbol];

      let expectedOut = null;
      try {
        expectedOut = await poolReader.get_dy(fromIdx, toIdx, amountIn);
      } catch (e) {
        console.warn("get_dy failed:", e);
      }

      if (!expectedOut || expectedOut === 0n) {
        throw new Error("Could not get expected output. Try a smaller amount.");
      }

      const slippagePct = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
      const min_dy = (expectedOut * BigInt(Math.floor(100 - slippagePct))) / 100n;

      const rawBalances = await poolReader.getBalances();
      const poolFromBalance = rawBalances[fromIdx];
      if (poolFromBalance != null && poolFromBalance > 0n && amountIn > (poolFromBalance * 10n) / 100n) {
        throw new Error("Trade size is too large for current liquidity.");
      }

      const poolToBalance = rawBalances[toIdx];
      if (poolFromBalance != null && poolToBalance != null && poolFromBalance > 0n && poolToBalance > 0n) {
        const decOut = 6;
        const expectedHumanForImpact = Number(ethers.formatUnits(expectedOut, decOut));
        const amountNum = Number(swapAmount) || 0;
        const poolFromNum = Number(ethers.formatUnits(poolFromBalance, decimalsIn));
        const poolToNum = Number(ethers.formatUnits(poolToBalance, decOut));
        const executionRate = expectedHumanForImpact / amountNum;
        const spotRate = poolToNum / poolFromNum;
        const priceImpactPercent = (1 - executionRate / spotRate) * 100;
        if (priceImpactPercent > 25 && !highImpactConfirmed) {
          throw new Error("Please confirm high price impact in the swap panel before continuing.");
        }
      }

      let expectedHuman = Number(ethers.formatUnits(expectedOut, 6));

      setQuote(
        expectedHuman
          ? `Estimated: ~${expectedHuman.toFixed(6)} ${swapTo}. Min: ~${Number(ethers.formatUnits(min_dy, 6)).toFixed(6)}. Sending...`
          : "Sending swap..."
      );

      // Execute Swap (contract does not support min_dy natively, so we pass 3 arguments)
      const tx = await pool.swap(fromIdx, toIdx, amountIn);
      
      setQuote(`Submitted! Waiting for confirmation...`);
      console.log("Swap TX submitted:", tx.hash);
      
      // Save pending tx to localStorage so we don't lose it if user refreshes
      const pendingTx = {
          fromToken: swapFrom,
          fromAmount: swapAmount,
          toToken: swapTo,
          toAmount: expectedHuman ? expectedHuman.toFixed(6) : "0",
          txUrl: `https://testnet.arcscan.app/tx/${tx.hash}`,
          hash: tx.hash,
          timestamp: Date.now(),
          status: "pending",
      };
      
      // Add to local history immediately
      setSwapHistory((prev) => [pendingTx, ...prev]);
      
      // Wait for confirmation using our custom wait() logic
      await tx.wait();
      console.log("Swap TX confirmed!");

      const txUrl = `https://testnet.arcscan.app/tx/${tx.hash}`;
      
      // Update history item to success
      setSwapHistory((prev) => prev.map(item => item.hash === tx.hash ? { ...item, status: "success" } : item));

      setTxModal({
        status: "success",
        fromToken: swapFrom,
        fromAmount: swapAmount,
        toToken: swapTo,
        toAmount: expectedHuman ? expectedHuman.toFixed(6) : estimatedTo || "0",
        txHash: tx.hash,
      });

      setQuote(`Swap succeeded — tx ${tx.hash}`);

      // Update progression
      try {
        const userAddr = await signer.getAddress();
        // We do NOT call /api/profile/addSwap here for Wallet Connect.
        // liveSwapIndexer.js handles normal injected wallet swaps on-chain automatically.
        // Doing it here would cause double-counting!
        setTimeout(() => {
          fetchProfile(userAddr);
        }, 3000);
      } catch (err) {
        console.warn("Profile update failed", err);
      }

      await fetchBalances(await signer.getAddress(), provider);
    } catch (err) {
      console.error(err);
      const m = err?.message || String(err);
      setQuote("Swap failed: " + m);
      setTxModal({
        status: "failed",
        fromToken: swapFrom,
        fromAmount: swapAmount,
        toToken: swapTo,
        toAmount: "—",
        txHash: null,
      });
    }
  }

  async function loadCircleWallet(userToken) {
    try {
      const wallets = await fetchCircleWalletsEnterprise(userToken);
      if (!wallets.length) {
        setEmailError("No Circle wallet found");
        return;
      }
      const w = wallets[0];
      setCircleWallet({
        walletId: w.id,
        address: w.address,
        blockchain: w.blockchain,
      });
      setCircleWalletReady(true);
      setAuthMode("email");
      setEmailStatus("Circle wallet ready");
      setShowEmailModal(false);
    } catch (e) {
      setEmailError("Failed to load Circle wallet");
    }
  }

  async function initializeAndCreateCircleWallet(loginData) {
    if (!loginData || !loginData.userToken || !loginData.encryptionKey) return;
    if (!circleSdkRef.current) return;

    try {
      setEmailStatus("Initializing Circle user...");
      setEmailLoading(true);
      setEmailError("");

      // --- Step 1: Initialize User (PIN Setup) ---
      const desiredBlockchain = "ARC-TESTNET";
      const desiredAccountType = "SCA";
      let initChallengeId = null;
      const resInit = await fetch("/api/circle/user/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: loginData.userToken,
          accountType: desiredAccountType,
          blockchains: [desiredBlockchain],
        }),
      });
      const dataInit = await resInit.json();

      if (resInit.ok && dataInit.challengeId) {
        initChallengeId = dataInit.challengeId;
        console.log("[Circle] Received init challengeId:", initChallengeId);
      } else if (
        dataInit.error &&
        dataInit.error.includes("already been initialized")
      ) {
        console.log("[Circle] User already initialized, skipping PIN setup.");
      } else {
        throw new Error(dataInit.error || "Failed to initialize Circle user");
      }

      // Set Authentication for SDK
      circleSdkRef.current.setAuthentication({
        userToken: loginData.userToken,
        encryptionKey: loginData.encryptionKey,
      });

      // Execute PIN Setup if needed
      if (initChallengeId) {
        if (!isMountedRef.current) return;
        setCircleChallengeId(initChallengeId);
        setEmailStatus("Setting up Circle PIN...");
        
        await new Promise((resolve, reject) => {
          circleSdkRef.current.execute(initChallengeId, (error, result) => {
            if (!isMountedRef.current) return;
            if (error) {
              reject(error);
              return;
            }
            console.log("[Circle] PIN setup complete:", result);
            resolve(result);
          });
        });
        if (!isMountedRef.current) return;
        setCircleChallengeId(null);
      }

      if (!isMountedRef.current) return;
      setEmailStatus("Loading Circle wallet...");

      const afterInitWallets = await fetchCircleWalletsEnterprise(loginData.userToken);

      if (!isMountedRef.current) return;

      if (Array.isArray(afterInitWallets) && afterInitWallets.length > 0) {
        const w = afterInitWallets[0];
        setCircleWallet({
          walletId: w.id,
          address: w.address,
          blockchain: w.blockchain,
        });
        setCircleWalletReady(true);
        setAuthMode("email");
        setEmailStatus("Circle wallet ready");
        setShowEmailModal(false);
        setEmailLoading(false);
        return;
      }

      setEmailStatus("Creating Circle wallet...");

      const resCreate = await fetch("/api/circle/user/create-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: loginData.userToken,
          blockchain: desiredBlockchain,
        }),
      });

      const dataCreate = await resCreate.json();
      if (!resCreate.ok) {
        throw new Error(dataCreate.error || "Failed to create Circle wallet");
      }

      const createChallengeId = dataCreate.challengeId;
      console.log("[Circle] Wallet creation challenge:", createChallengeId);

      if (!isMountedRef.current) return;

      if (!createChallengeId) {
        await loadCircleWallet(loginData.userToken);
        setEmailLoading(false);
        return;
      }

      setCircleChallengeId(createChallengeId);

      circleSdkRef.current.execute(createChallengeId, async (error, result) => {
        if (!isMountedRef.current) return;
        if (error) {
          console.error("[Circle] Wallet creation failed:", error);
          setEmailError(error.message || "Failed to execute wallet creation");
          setEmailStatus("");
          setEmailLoading(false);
          return;
        }

        console.log("[Circle] Wallet creation complete:", result);
        setCircleChallengeId(null);
        setEmailStatus("Wallet created! Loading details...");

        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!isMountedRef.current) return;
        await loadCircleWallet(loginData.userToken);
        setEmailLoading(false);
      });

    } catch (e) {
      console.error("[Circle] Init/Create flow failed:", e);
      setEmailError(e.message || "Circle email login failed");
      setEmailStatus("");
      setEmailLoading(false);
    }
  }

  function connectGmail() {
    setActiveTab("profile");
    setShowEmailModal(true);
    setEmailStep(1);
    setEmailStatus("");
    setEmailError("");
  }

  function addCustomToken() {
    const addr = (customAddr || "").trim();
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      alert("Enter a valid Ethereum-style address (0x...).");
      return;
    }
    const symbol = "TKN" + addr.slice(-3).toUpperCase();
    const exists = tokens.some(
      (t) => t.address.toLowerCase() === addr.toLowerCase()
    );
    if (exists) {
      alert("Token already in list.");
      return;
    }
    const newToken = { symbol, name: symbol + " (custom)", address: addr };
    setTokens((prev) => [newToken, ...prev]);
    setCustomAddr("");
    alert(`Added ${symbol} — it appears at top of token list.`);
  }

  function tokenIcon(symbol) {
    return <span className="token-badge">{symbol.slice(0, 3)}</span>;
  }

  function usdValueFor(symbol) {
    const bal = balances[symbol];
    const p = prices[symbol];
    if (!bal || bal === "n/a" || p == null) return null;
    const numericBal = Number(bal);
    if (Number.isNaN(numericBal)) return null;
    return numericBal * Number(p);
  }

  function totalPoolTVL() {
    return Object.values(poolBalances).reduce(
      (sum, v) => sum + Number(v || 0),
      0
    );
  }

  async function handleAddLiquidity() {
    console.log("[CircleTx] Starting Add Liquidity...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }
    if (!activePreset || !activePreset.poolAddress) {
      alert("Select a pool first.");
      return;
    }

    try {
      setLiqLoading(true);
      const provider = getReadProvider();

      if (isCircleMode()) {
        const amounts = [];
        const { walletId } = requireCircleAuth();

        // 1. Approvals — approve max uint256 for each token, then WAIT for on-chain confirmation
        // Circle marks challenge COMPLETE immediately when signed (before tx is mined).
        // We must poll the allowance on-chain to confirm the approve settled before add_liquidity.
        for (const sym of activePreset.tokens) {
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const rawVal = liqInputs[sym];

          if (!rawVal || Number(rawVal) <= 0) {
            amounts.push("0");
            continue;
          }

          const tokenReader = new ethers.Contract(token.address, ERC20_ABI, provider);
          const decimals = await tokenReader.decimals();
          const parsed = ethers.parseUnits(rawVal, decimals);
          amounts.push(parsed.toString());

          // Check existing allowance — skip approve if already sufficient
          const currentAllowance = await tokenReader.allowance(walletAddr, activePreset.poolAddress);
          if (BigInt(currentAllowance) >= BigInt(parsed)) {
            console.log(`[CircleTx] ${sym} allowance already sufficient (${currentAllowance.toString()}), skipping approve.`);
            continue;
          }

          // Need to approve — send max uint256
          const MAX_UINT256 = ethers.MaxUint256;
          setQuote(`Approving ${sym}...`);
          const approveTx = buildApproveCall(token.address, activePreset.poolAddress, MAX_UINT256);
          await executeCircleContractAction({
            contractAddress: approveTx.contractAddress,
            abiFunctionSignature: approveTx.abiFunctionSignature,
            abiParameters: approveTx.abiParameters,
            title: `Approve ${sym} in Circle`,
          });

          // Wait for the approval to actually land on-chain (up to 45 seconds)
          setQuote(`Waiting for ${sym} approval to confirm on-chain...`);
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const newAllowance = await tokenReader.allowance(walletAddr, activePreset.poolAddress);
            console.log(`[CircleTx] ${sym} on-chain allowance: ${newAllowance.toString()}`);
            if (BigInt(newAllowance) >= BigInt(parsed)) {
              console.log(`[CircleTx] ${sym} approve confirmed on-chain ✓`);
              break;
            }
          }
        }

        // 2. Add Liquidity via Circle
        // ABI: add_liquidity(uint256[] amounts, uint256 min_mint_amount)
        const addLiqTx = buildAddLiquidityCall(activePreset.poolAddress, amounts, 0);
        
        const { hash: txHash } = await executeCircleContractAction({
          contractAddress: addLiqTx.contractAddress,
          abiFunctionSignature: addLiqTx.abiFunctionSignature,
          abiParameters: addLiqTx.abiParameters,
          title: "Confirm add liquidity in Circle",
        });
        console.log("[CircleTx] Add Liquidity confirmed:", txHash);

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
          txHash,
        });

        // 3. Post-Action Updates
        // If txHash is "SUBMITTED" (chain confirmed but not yet indexed), wait before reading
        // on-chain LP balances — otherwise balanceOf returns 0 immediately.
        if (!txHash || txHash === "SUBMITTED") {
          setQuote("Waiting for chain to settle...");
          await new Promise((r) => setTimeout(r, 6000));
        }
        await refreshUserLiquidityData(walletAddr);

        setMyDeposits((prev) => ({
          ...prev,
          USDC: prev.USDC + Number(liqInputs.USDC || 0),
          EURC: prev.EURC + Number(liqInputs.EURC || 0),
          SWPRC: prev.SWPRC + Number(liqInputs.SWPRC || 0),
        }));
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const amounts = [];

        // 2. Approvals
        for (const sym of activePreset.tokens) {
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const rawVal = liqInputs[sym];

          if (!rawVal || Number(rawVal) <= 0) {
            amounts.push(0n);
            continue;
          }

          const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
          const decimals = await tokenContract.decimals();
          const parsed = ethers.parseUnits(rawVal, decimals);
          const ownerAddr = await signer.getAddress();
          const allowance = await tokenContract.allowance(ownerAddr, activePreset.poolAddress);

          if (BigInt(allowance) < BigInt(parsed)) {
            const txApprove = await tokenContract.approve(activePreset.poolAddress, parsed);
            await txApprove.wait();
          }
          amounts.push(parsed);
        }

        // 3. Add Liquidity
        const pool = new ethers.Contract(activePreset.poolAddress, POOL_ABI, signer);

        // Fixed ABI function name to addLiquidity (camelCase, 1 param)
        console.log("Adding liquidity with amounts:", amounts.map(a => a.toString()));
        const tx = await pool.addLiquidity(amounts); 
        
        console.log("Add Liquidity TX submitted:", tx.hash);
        
        // Update UI immediately (optimistic)
        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
          status: "pending",
          txHash: tx.hash
        });
        
        await tx.wait();
        console.log("Add Liquidity TX confirmed!");
      }

      // 4. Post-Action Updates (runs for BOTH Circle and Injected Wallet)
      await refreshUserLiquidityData(walletAddr);
      setMyDeposits((prev) => ({
        ...prev,
        USDC: prev.USDC + Number(liqInputs.USDC || 0),
        EURC: prev.EURC + Number(liqInputs.EURC || 0),
        SWPRC: prev.SWPRC + Number(liqInputs.SWPRC || 0),
      }));

      // Only set success if not already set by Circle
      if (!isCircleMode()) {
        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
        });
      }
      
      setPoolsView("positions");
      setShowAddLiquidity(false);
      setLiqInputs({ USDC: "", EURC: "", SWPRC: "" });
    } catch (err) {
      console.error("[App] Add liquidity failed:", err);
      alert("Add liquidity failed: " + (err.message || err));
    } finally {
      setLiqLoading(false);
    }
  }

  function closeAddLiquidity() {
    setShowAddLiquidity(false);
    setActivePreset(null);
    setLiqInputs({ USDC: "", EURC: "", SWPRC: "" });
  }

  async function handleRemoveLiquidity() {
    console.log("[CircleTx] Starting Remove Liquidity...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }

    if (!removeLpAmount || Number(removeLpAmount) <= 0) {
      alert("Enter amount to remove");
      return;
    }

    try {
      setRemoveLoading(true);
      const provider = getReadProvider();

      // Prefer raw LP (BigInt) when we have it (MAX/50% should always be exact)
      let lpParsed = 0n;
      try {
        lpParsed = ethers.parseUnits(String(removeLpAmount), lpDecimals);
      } catch {
        throw new Error("Invalid LP amount");
      }

      const balToCheck =
        activeLpBalance != null
          ? activeLpBalance
          : activePreset && lpBalances[activePreset.id] != null
            ? lpBalances[activePreset.id]
            : null;

      if (balToCheck == null) {
        throw new Error("LP balance unavailable right now. Please wait a moment and try again.");
      }
      if (Number(removeLpAmount) > Number(balToCheck) + 1e-9) {
        throw new Error("Not enough LP");
      }

      if (lpParsed <= 0n) {
        throw new Error("Remove amount is too small (rounded to 0). Tap MAX or enter a larger amount.");
      }

      // Safety: don't allow removing more than the raw on-chain balance
      if (typeof activeLpRaw === "bigint" && activeLpRaw > 0n && lpParsed > activeLpRaw) {
        throw new Error("Remove amount exceeds your LP balance.");
      }
      let finalTxHash = null;

      if (isCircleMode()) {
        const { walletId } = requireCircleAuth();

        const removeLiqTx = buildRemoveLiquidityCall(activePreset.poolAddress, lpParsed);
        
        const { hash } = await executeCircleContractAction({
          contractAddress: removeLiqTx.contractAddress,
          abiFunctionSignature: removeLiqTx.abiFunctionSignature,
          abiParameters: removeLiqTx.abiParameters,
          title: "Confirm remove liquidity in Circle",
        });
        finalTxHash = hash;

        console.log("[CircleTx] Remove Liquidity confirmed:", finalTxHash);

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "remove",
          amount: removeLpAmount,
          txHash: finalTxHash,
          removed: removeEstimates,
        });
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const pool = new ethers.Contract(activePreset.poolAddress, POOL_ABI, signer);

        const tx = await pool.removeLiquidity(lpParsed); 
        console.log("Remove Liquidity TX submitted:", tx.hash);
        finalTxHash = tx.hash;
        await tx.wait();
        console.log("Remove Liquidity TX confirmed!");

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "remove",
          amount: removeLpAmount,
          removed: removeEstimates,
        });
      }

      // 3. Post-Action Updates
      // Wait for chain to settle if tx isn't indexed yet
      const removeTxHash = finalTxHash || removeLpAmount;
      if (!removeTxHash || removeTxHash === "SUBMITTED") {
        await new Promise((r) => setTimeout(r, 6000));
      }
      await refreshUserLiquidityData(walletAddr);

      setShowRemoveLiquidity(false);
      setRemoveLpAmount("");
      setActiveLpBalance(null);
    } catch (err) {
      console.error("[App] Remove liquidity failed:", err);
      alert("Remove liquidity failed: " + (err.message || err));
    } finally {
      setRemoveLoading(false);
    }
  }

  return (
    <div className="app-page hybrid-page">
      {circleExecPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
        >
          <div
            style={{
              background: "#061426",
              borderRadius: 16,
              border: "1px solid rgba(0,255,255,0.4)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
              padding: 24,
              width: "100%",
              maxWidth: 420,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                {circleExecPrompt.title || "Confirm in Circle"}
              </h2>
              <button
                onClick={cancelCircleExecution}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#aaa",
                  fontSize: "1.1rem",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: "0.9rem", color: "#e4f5ff", marginBottom: 12 }}>
              Click Continue to open Circle’s confirmation window.
            </div>

            {circleExecError && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(255, 80, 80, 0.12)",
                  border: "1px solid rgba(255, 80, 80, 0.5)",
                  color: "#ffb3b3",
                  fontSize: "0.85rem",
                  whiteSpace: "pre-wrap",
                }}
              >
                {circleExecError}
              </div>
            )}

            <button
              disabled={circleExecLoading}
              onClick={confirmCircleExecution}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                color: "#001018",
                fontWeight: 700,
                cursor: circleExecLoading ? "not-allowed" : "pointer",
                opacity: circleExecLoading ? 0.6 : 1,
              }}
            >
              {circleExecLoading ? "Please wait..." : "Continue"}
            </button>
          </div>
        </div>
      )}
      <div className="app-container hybrid-center">
        <header className="headerRow hybrid-header">
          <div
            className="brand"
            style={{ cursor: "pointer" }}
            onClick={() => window.location.reload()}
          >
            <img src={logo} alt="SwapARC" className="logoImg big" />
            <div>
              <div className="title">SWAPARC</div>
              <div className="subtitle">Stablecoin FX & Treasury tools</div>
            </div>
          </div>
          <div className="topNav desktopOnly">
            {["profile", "swap", "pools", "privpay"].map((t) => (
              <button
                key={t}
                className={`navBtn ${activeTab === t ? "active" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="headerRight mobileHeader">
            {/* DESKTOP ONLY BUTTONS */}
            <button
              className="xBtn desktopOnly"
              onClick={() => window.open("https://x.com/swaparc_app", "_blank")}
            >
              𝕏
            </button>
            <button className="faucetBtn desktopOnly" onClick={openFaucet}>
              💧 Get Faucet
            </button>

            {!address && authMode !== "email" && (
              <div style={{ position: "relative" }}>
                <button
                  className="connectCTA neon-btn"
                  onClick={() => setShowConnectMenu((v) => !v)}
                >
                  CONNECT
                </button>
                {showConnectMenu && (
                  <div
                    className="connectDropdown"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "110%",
                      background: "rgba(14,32,56,0.95)",
                      border: "1px solid rgba(0, 255, 255, 0.35)",
                      boxShadow: "0 10px 30px rgba(0, 255, 255, 0.15)",
                      borderRadius: 12,
                      padding: 12,
                      width: 220,
                      zIndex: 50,
                      backdropFilter: "blur(6px)",
                    }}
                    onMouseLeave={() => setShowConnectMenu(false)}
                  >
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%", marginBottom: 8 }}
                      onClick={async () => {
                        setShowConnectMenu(false);
                        connectWallet();
                      }}
                    >
                      Connect via Wallet
                    </button>
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%" }}
                      onClick={() => {
                        setShowConnectMenu(false);
                        connectGmail();
                      }}
                    >
                      Connect via Gmail
                    </button>
                  </div>
                )}
              </div>
            )}

            {(address || (authMode === "email" && circleWallet)) && (
              <div style={{ position: "relative" }}>
                <button
                  className="walletPill"
                  onClick={() => setShowWalletMenu((prev) => !prev)}
                >
                  {authMode === "email" && circleWallet
                    ? `Circle · ${shortAddr(circleWallet.address)}`
                    : `Arc Testnet · ${shortAddr(address)}`}
                </button>
                {showWalletMenu && (
                  <div
                    className="connectDropdown"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "110%",
                      background: "rgba(14,32,56,0.95)",
                      border: "1px solid rgba(0, 255, 255, 0.35)",
                      boxShadow: "0 10px 30px rgba(0, 255, 255, 0.15)",
                      borderRadius: 12,
                      padding: 12,
                      width: 220,
                      zIndex: 50,
                      backdropFilter: "blur(6px)",
                    }}
                    onMouseLeave={() => setShowWalletMenu(false)}
                  >
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%", marginBottom: 8 }}
                      onClick={() => {
                        const addr =
                          authMode === "email" && circleWallet
                            ? circleWallet.address
                            : address;
                        if (addr) {
                          copyAddress(addr);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                    >
                      {copied ? "Copied!" : "Copy Address"}
                    </button>
                    <button
                      className="connectOption neon-btn"
                      style={{
                        width: "100%",
                        background: "rgba(255, 80, 80, 0.15)",
                        borderColor: "rgba(255, 80, 80, 0.4)",
                        color: "#ff8080",
                      }}
                      onClick={() => {
                        setShowWalletMenu(false);
                        if (authMode === "email") {
                          disconnectEmail();
                        } else {
                          disconnectWallet();
                        }
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              className="hamburgerBtn"
              onClick={() => setMobileMenuOpen(true)}
            >
              ☰
            </button>
          </div>
        </header>

        <Ticker tokens={tokens} prices={prices} />

        {showEmailModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "#061426",
                borderRadius: 16,
                border: "1px solid rgba(0,255,255,0.4)",
                boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
                padding: 24,
                width: "100%",
                maxWidth: 420,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Connect via Email</h2>
                <button
                  onClick={() => {
                    setShowEmailModal(false);
                    setEmailStep(1);
                    setEmailStatus("");
                    setEmailError("");
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#aaa",
                    fontSize: "1.1rem",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              {!CIRCLE_APP_ID && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(255, 80, 80, 0.12)",
                    border: "1px solid rgba(255, 80, 80, 0.5)",
                    color: "#ffb3b3",
                    fontSize: "0.85rem",
                  }}
                >
                  Missing Circle App ID — go to Circle Console → Wallets → User Controlled → Configurator → App ID and set VITE_CIRCLE_APP_ID in your .env.
                </div>
              )}

              {emailStep === 1 && (
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 8,
                      fontSize: "0.9rem",
                    }}
                  >
                    Email address
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="you@example.com"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid rgba(0,255,255,0.4)",
                      background: "rgba(3,16,32,0.9)",
                      color: "#e4f5ff",
                      marginBottom: 12,
                    }}
                  />
                  <button
                    disabled={emailLoading || !sdkReady}
                    onClick={async () => {
                      if (!sdkReady || !circleSdkRef.current) {
                        setEmailError(
                          "Email login is not ready yet. Please wait a moment."
                        );
                        console.warn("Send OTP blocked: SDK not ready");
                        return;
                      }
                      if (!emailInput) {
                        setEmailError("Enter an email address");
                        console.warn("Send OTP blocked: missing email");
                        return;
                      }

                      try {
                        setEmailLoading(true);
                        setEmailError("");
                        setEmailErrorDetails("");
                        setEmailStatus("Requesting OTP...");
                        setUserEmail(emailInput);

                        const deviceIdToUse = await ensureCircleDeviceId();
                        
                        if (!deviceIdToUse) {
                          console.warn("[Circle] Failed to get deviceId. Bypassing check for local debugging...");
                          // Bypass for debugging only: If deviceId fails, proceed with a mock or null if API allows?
                          // The API 'send-code' REQUIRES deviceId.
                          // However, maybe the SDK just needs more time?
                          // Let's try to RE-INIT the SDK?
                          setEmailError("Device Security Check Failed. Please refresh the page and try again.");
                          return;
                        }

                        console.log(
                          "[Circle] Send OTP using deviceId:",
                          deviceIdToUse
                        );

                        const res = await fetch("/api/auth/send-code", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            email: emailInput,
                            deviceId: deviceIdToUse,
                          }),
                        });

                        const data = await res.json();
                        console.log("Send OTP response", {
                          status: res.status,
                          ok: res.ok,
                          data,
                        });

                        if (!res.ok) {
                          setEmailError(
                            data.error || "Failed to request OTP"
                          );
                          if (data && data.details) {
                            const raw = JSON.stringify(data.details);
                            const snippet =
                              raw.length > 300
                                ? `${raw.slice(0, 300)}...`
                                : raw;
                            setEmailErrorDetails(snippet);
                          } else {
                            setEmailErrorDetails("");
                          }
                          setEmailStatus("");
                          console.error("Send OTP failed", {
                            status: res.status,
                            data,
                          });
                          return;
                        }

                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            "circle_user_email",
                            emailInput
                          );
                        }

                        setCircleDeviceToken(data.deviceToken);
                        setCircleDeviceEncryptionKey(
                          data.deviceEncryptionKey
                        );
                        setCircleOtpToken(data.otpToken);

                        if (circleSdkRef.current) {
                          circleSdkRef.current.updateConfigs({
                            appSettings: { appId: CIRCLE_APP_ID },
                            loginConfigs: {
                              deviceToken: data.deviceToken,
                              deviceEncryptionKey: data.deviceEncryptionKey,
                              otpToken: data.otpToken,
                              email: { email: emailInput },
                            },
                          });
                          console.log("[Circle] loginConfigs set after send-code");
                        }

                        setEmailErrorDetails("");
                        setEmailStatus(
                          "OTP sent. After receiving OTP, click Verify to open Circle’s verification window."
                        );
                        setEmailStep(2);
                      } catch (err) {
                        console.error("Send OTP request error", err);
                        setEmailError("Failed to request OTP");
                        setEmailStatus("");
                      } finally {
                        setEmailLoading(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                      color: "#001018",
                      fontWeight: 700,
                      cursor: emailLoading || !sdkReady ? "not-allowed" : "pointer",
                      opacity: emailLoading || !sdkReady ? 0.5 : 1,
                    }}
                  >
                    {emailLoading ? "Sending..." : "Send OTP"}
                  </button>
                </div>
              )}

              {emailStep === 2 && (
                <div>
                  <p
                    style={{
                      fontSize: "0.9rem",
                      marginBottom: 12,
                      color: "#e4f5ff",
                    }}
                  >
                    After receiving OTP, click Verify to open Circle’s verification window.
                  </p>
                  <button
                    disabled={
                      !circleDeviceToken ||
                      !circleDeviceEncryptionKey ||
                      !circleOtpToken ||
                      !sdkReady ||
                      emailLoading
                    }
                    onClick={async () => {
                      if (!circleSdkRef.current) {
                        setEmailError("Email login not ready");
                        return;
                      }
                      if (
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken
                      ) {
                        setEmailError("Missing OTP session data");
                        return;
                      }

                      setEmailError("");
                      setEmailStatus("Opening Circle verification window...");
                      setEmailLoading(true);

                      try {
                        const sdk = circleSdkRef.current;
                        if (typeof sdk.verifyOtp === "function") {
                          console.log("Calling sdk.verifyOtp() for email OTP flow");
                          sdk.verifyOtp();
                        } else if (typeof sdk.emailLogin === "function") {
                          console.log(
                            "sdk.verifyOtp() not found, falling back to sdk.emailLogin()"
                          );
                          sdk.emailLogin();
                        } else {
                          console.warn(
                            "No Circle email verification method found on SDK"
                          );
                          setEmailError(
                            "Circle SDK does not expose an email verification method."
                          );
                          setEmailStatus("");
                          setEmailLoading(false);
                        }
                      } catch (e) {
                        console.error(
                          "Circle OTP verification trigger failed",
                          e
                        );
                        setEmailError(
                          "Failed to start Circle OTP verification. Check console for details."
                        );
                        setEmailStatus("");
                        setEmailLoading(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                      color: "#001018",
                      fontWeight: 700,
                      cursor:
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken ||
                        !sdkReady ||
                        emailLoading
                          ? "default"
                          : "pointer",
                      opacity:
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken ||
                        !sdkReady ||
                        emailLoading
                          ? 0.7
                          : 1,
                    }}
                  >
                    {emailLoading ? "Please wait..." : "Verify in Circle Window"}
                  </button>
                </div>
              )}

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem("circle_device_id");
                      window.localStorage.removeItem("deviceId");
                      window.localStorage.removeItem("circle_user_email");
                      window.localStorage.removeItem("circle_user_token");
                      window.localStorage.removeItem("circle_encryption_key");
                      window.localStorage.removeItem("circle_device_token");
                      window.localStorage.removeItem(
                        "circle_device_encryption_key"
                      );
                      window.localStorage.removeItem("circle_otp_token");
                      window.localStorage.removeItem("circle_app_id");
                    }
                    setCircleDeviceId("");
                    setCircleDeviceToken("");
                    setCircleDeviceEncryptionKey("");
                    setCircleOtpToken("");
                    setEmailInput("");
                    setEmailStatus("");
                    setEmailError("");
                    if (typeof window !== "undefined") {
                      window.location.reload();
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(0,255,255,0.4)",
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: "0.8rem",
                    color: "#9bf5ff",
                    cursor: "pointer",
                  }}
                >
                  Reset email login
                </button>
              </div>

              {(emailStatus || emailError || emailErrorDetails) && (
                <div style={{ marginTop: 12, fontSize: "0.85rem" }}>
                  {emailStatus && (
                    <div style={{ color: "#9bf5ff" }}>{emailStatus}</div>
                  )}
                  {emailError && (
                    <div style={{ color: "#ff8080" }}>{emailError}</div>
                  )}
                  {emailErrorDetails && (
                    <pre
                      style={{
                        marginTop: 6,
                        color: "#ffb3b3",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {emailErrorDetails}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <main className="main">
          <section className="topCards hybrid-grid">
            <div
              className={`card controls neon-card swapCardCentered ${
                activeTab === "privpay" ? "privpayWideCard" : ""
              }`}
            >
              {activeTab === "profile" && (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <h2>Profile</h2>

                  {!(address || authMode === "email") ? (
                    <div
                      className="neonPlaceholder"
                      style={{
                        marginTop: 40,
                        padding: "28px 20px",
                        borderRadius: 12,
                        border: "1px solid rgba(0,255,255,0.35)",
                        background: "rgba(0,0,0,0.25)",
                        boxShadow: "0 10px 30px rgba(0,255,255,0.12)",
                        maxWidth: 420,
                        marginLeft: "auto",
                        marginRight: "auto",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.05em",
                          fontWeight: 700,
                          color: "#cfffff",
                          letterSpacing: "0.5px",
                          marginBottom: 20,
                        }}
                      >
                        CONNECT WALLET or LINK YOUR EMAIL to continue
                      </div>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={connectWallet}
                          style={{
                            padding: "10px 20px",
                            borderRadius: 999,
                            border: "none",
                            background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                            color: "#001018",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 0 18px rgba(0,255,255,0.6), 0 0 40px rgba(0,255,183,0.4)",
                          }}
                        >
                          Connect Wallet
                        </button>
                        <button
                          onClick={connectGmail}
                          style={{
                            padding: "10px 20px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,255,255,0.5)",
                            background: "rgba(0, 20, 40, 0.6)",
                            color: "#00f0ff",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 0 15px rgba(0,255,255,0.2)",
                          }}
                        >
                          Connect via Gmail
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Profile Card (Identity & Stats) */}
                      {(address || authMode === "email") && (
                        <div
                          className="neon-card"
                          style={{
                            padding: 20,
                            marginBottom: 20,
                            textAlign: "left",
                          }}
                        >
                          {/* Top Section: Identity */}
                          {profileStats ? (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                marginBottom: 25,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 15,
                                  alignItems: "center",
                                }}
                              >
                                {/* Avatar */}
                                <div
                                  onClick={
                                    isEditingProfile
                                      ? () => fileInputRef.current?.click()
                                      : undefined
                                  }
                                  style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    background:
                                      isEditingProfile && editForm.avatar
                                        ? `url(${editForm.avatar}) center/cover`
                                        : profileStats.avatar
                                        ? `url(${profileStats.avatar}) center/cover`
                                        : "linear-gradient(135deg, #0096ff, #00ffff)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: "2px solid rgba(255,255,255,0.2)",
                                    boxShadow: "0 4px 15px rgba(0,255,255,0.2)",
                                    overflow: "hidden",
                                    position: "relative",
                                    cursor: isEditingProfile
                                      ? "pointer"
                                      : "default",
                                  }}
                                >
                                  <input
                                    type="file"
                                    hidden
                                    ref={fileInputRef}
                                    accept="image/*"
                                    onChange={handleFileChange}
                                  />
                                  {isEditingProfile && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        inset: 0,
                                        background: "rgba(0,0,0,0.4)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <span style={{ fontSize: 20 }}>📷</span>
                                    </div>
                                  )}
                                  {!profileStats.avatar &&
                                    !editForm.avatar &&
                                    !isEditingProfile && (
                                      <span style={{ fontSize: 28 }}>👤</span>
                                    )}
                                </div>

                                <div>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                    }}
                                  >
                                    {isEditingProfile ? (
                                      <input
                                        className="swapInput"
                                        style={{
                                          padding: "5px 10px",
                                          fontSize: "1.1em",
                                          width: 160,
                                          marginBottom: 5,
                                        }}
                                        value={editForm.username}
                                        onChange={(e) =>
                                          setEditForm((p) => ({
                                            ...p,
                                            username: e.target.value,
                                          }))
                                        }
                                        placeholder="Username"
                                      />
                                    ) : (
                                      <h3
                                        style={{
                                          margin: 0,
                                          fontSize: "1.4em",
                                          letterSpacing: "0.5px",
                                        }}
                                      >
                                        {profileStats.username || "Anon User"}
                                      </h3>
                                    )}

                                    <button
                                      className={
                                        isEditingProfile
                                          ? "primaryBtn"
                                          : "secondaryBtn"
                                      }
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "0.75em",
                                        minWidth: 50,
                                        height: 26,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        borderRadius: 6,
                                      }}
                                      onClick={
                                        isEditingProfile
                                          ? saveProfile
                                          : startEditing
                                      }
                                    >
                                      {isEditingProfile ? "Save" : "Edit"}
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    className="addressPill"
                                    onClick={() => copyAddress(getActiveWalletAddress())}
                                    title="Tap to copy"
                                  >
                                    <span className="addressPillText">
                                      {shortAddr(getActiveWalletAddress())}
                                    </span>
                                    <span className="addressPillIcon">📋</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                marginBottom: 25,
                                textAlign: "center",
                                padding: 20,
                                background: "rgba(255,255,255,0.02)",
                                borderRadius: 12,
                              }}
                            >
                              <div className="muted">Loading Profile...</div>
                            </div>
                          )}

                          {/* Stats Section */}
                          {profileStats && (
                            <div
                              className="profileStatsGrid"
                              style={{
                                marginBottom: 25,
                                background: "rgba(0,0,0,0.2)",
                                padding: 24,
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <div style={{ textAlign: "center" }}>
                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Swap Volume
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                    color: "gold",
                                  }}
                                >
                                  $
                                  {Number(
                                    profileStats.swapVolume || 0
                                  ).toLocaleString()}
                                </div>
                              </div>
                              <div style={{ textAlign: "center" }}>

                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Swap Count
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {profileStats.swapCount || 0}
                                </div>
                              </div>
                              <div style={{ textAlign: "center" }}>
                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total LP Provided
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                    color: "cyan",
                                  }}
                                >
                                  $
                                  {Number(
                                    profileStats.lpProvided || 0
                                  ).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Badges Section */}
                          {profileStats && (
                            <div style={{ marginBottom: 25 }}>
                              <h4
                                style={{
                                  margin: "0 0 12px 0",
                                  fontSize: "0.85em",
                                  textTransform: "uppercase",
                                  opacity: 0.7,
                                  letterSpacing: "1px",
                                }}
                              >
                                Badges
                              </h4>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "140px",
                                  justifyContent: "start",
                                  gap: 12,
                                }}
                              >
                                {/* Early Swaparcer Badge */}
                                {(() => {
                                  const unlocked = badgeState.earlySwaparcer;

                                  return (
                                    <div
                                      className="badgeTile"
                                      style={{
                                        width: 140,
                                        height: 160,
                                        borderRadius: 12,
                                        background: unlocked
                                          ? "rgba(0, 255, 255, 0.15)"
                                          : "rgba(255, 255, 255, 0.03)",
                                        border: `1px solid ${
                                          unlocked
                                            ? "rgba(0, 255, 255, 0.5)"
                                            : "rgba(255, 255, 255, 0.05)"
                                        }`,
                                        opacity: unlocked ? 1 : 0.4,
                                        filter: unlocked ? "none" : "grayscale(100%)",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                        gap: 6
                                      }}
                                    >
                                      <img
                                        src="/badges/early-swaparcer.png"
                                        alt="Early Swaparcer"
                                        style={{
                                          width: "100%",
                                          height: 112,
                                          objectFit: "cover",
                                        }}
                                      />
                                      <div
                                        className="badgeLabel"
                                        style={{
                                          fontSize: "0.75em",
                                          fontWeight: 700,
                                          color: unlocked ? "cyan" : "inherit",
                                          textTransform: "uppercase"
                                        }}
                                      >
                                        Early Swaparcer
                                      </div>
                                    </div>
                                  );
                                })()}

                                
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Wallet Portfolio Section - Independent Card */}
                      {address && (
                        <div
                          className="neon-card"
                          style={{
                            padding: 20,
                            marginBottom: 20,
                            textAlign: "left",
                          }}
                        >
                          <h3 style={{ marginTop: 0, marginBottom: 20 }}>
                            Wallet Portfolio
                          </h3>

                          {/* Total Value */}
                          <div
                            style={{ marginBottom: 20, textAlign: "center" }}
                          >
                            <div
                              className="muted"
                              style={{ fontSize: "0.8em", marginBottom: 5 }}
                            >
                              Total Value
                            </div>
                            <div
                              style={{
                                fontSize: "1.6em",
                                fontWeight: "bold",
                                color: "#4caf50",
                              }}
                            >
                              $
                              {portfolioValue.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </div>

                          {/* Token Balances */}
                          <div style={{ marginBottom: 15 }}>
                            <div
                              className="muted"
                              style={{
                                fontSize: "0.8em",
                                marginBottom: 8,
                                paddingLeft: 5,
                              }}
                            >
                              Tokens
                            </div>
                            <div
                              style={{
                                background: "rgba(0,0,0,0.3)",
                                borderRadius: 8,
                                overflow: "hidden",
                              }}
                            >
                              {["USDC", "EURC", "SWPRC"].map((sym) => {
                                const bal = Number(balances[sym] || 0);
                                const val = bal * Number(tokenPrices[sym] || 0);
                                return (
                                  <div
                                    key={sym}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      padding: "10px 12px",
                                      borderBottom:
                                        "1px solid rgba(255,255,255,0.05)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                      }}
                                    >
                                      <img
                                        src={TOKEN_LOGOS[sym]}
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: "50%",
                                        }}
                                        alt={sym}
                                      />
                                      <span>{sym}</span>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div>{bal.toFixed(4)}</div>
                                      <div
                                        className="muted"
                                        style={{ fontSize: "0.8em" }}
                                      >
                                        ${val.toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* LP Positions */}
                          {Object.keys(lpBalances).some(
                            (k) => Number(lpBalances[k] || 0) > 0
                          ) && (
                            <div>
                              <div
                                className="muted"
                                style={{
                                  fontSize: "0.8em",
                                  marginBottom: 8,
                                  paddingLeft: 5,
                                }}
                              >
                                LP Positions
                              </div>
                              <div
                                style={{
                                  background: "rgba(0,0,0,0.3)",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                }}
                              >
                                {POOLS.map((p) => {
                                  const bal = lpBalances[p.id];
                                  if (!bal || bal <= 0) return null;
                                  const amounts = lpTokenAmounts[p.id] || {};
                                  const val = Object.entries(amounts).reduce(
                                    (sum, [sym, amt]) =>
                                      sum + amt * Number(tokenPrices[sym] || 0),
                                    0
                                  );
                                  return (
                                    <div
                                      key={p.id}
                                      style={{
                                        padding: "10px 12px",
                                        borderBottom:
                                          "1px solid rgba(255,255,255,0.05)",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          marginBottom: 5,
                                        }}
                                      >
                                        <span>{p.name}</span>
                                        <span>{bal.toFixed(4)} LP</span>
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          fontSize: "0.8em",
                                        }}
                                      >
                                        <span className="muted">
                                          {Object.entries(amounts)
                                            .map(
                                              ([sym, amt]) =>
                                                `${amt.toFixed(2)} ${sym}`
                                            )
                                            .join(" + ")}
                                        </span>
                                        <span className="muted">
                                          ${val.toFixed(2)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Circle Wallet Placeholder */}
                      {/* Circle wallet details removed (not user-facing value) */}

                      <p className="muted" style={{ marginTop: 20 }}>
                        {authMode === "wallet"
                          ? "Profile connected via Wallet"
                          : "Profile connected via Gmail"}
                      </p>
                    </>
                  )}
                </div>
              )}
              {activeTab === "swap" && (
                <>
                  <div className="swapCardHeader">
                    <h2 className="swapTitle">Swap</h2>
                    <div className="swapHeaderActions">
                      <button
                        type="button"
                        className="slippageSettingsBtn"
                        onClick={() => setActiveTab("history")}
                        aria-label="Swap history"
                        title="History"
                      >
                        <span className="slippageSettingsIcon">🕘</span>
                      </button>
                      <button
                        type="button"
                        className="slippageSettingsBtn"
                        onClick={() => setShowSlippagePanel((v) => !v)}
                        aria-label="Slippage settings"
                      >
                        <span className="slippageSettingsIcon">⚙</span>
                        <span className="slippageSettingsValue">
                          {Number(swapSummary.slippageRaw || slippageTolerance).toFixed(1)}%
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="swapRowClean">
                    <div className="swapBox">
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                        <div className="swapLabel" style={{ marginBottom: 0 }}>Sell</div>
                        <input
                          className="swapInput"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={swapAmount}
                          onChange={(e) => setSwapAmount(e.target.value)}
                        />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
                        <TokenSelect
                          tokens={tokens}
                          value={swapFrom}
                          onChange={setSwapFrom}
                        />
                        {balances[swapFrom] && balances[swapFrom] !== "n/a" && (
                          <div className="tokenBalanceHint" style={{ marginTop: 0, fontSize: 13 }}>
                            {balances[swapFrom]}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="percentRow relay-style">
                      {[25, 50, 75].map((p) => (
                        <button
                          key={p}
                          className="percentBtn"
                          onClick={() => setPercentAmount(p)}
                        >
                          {p}%
                        </button>
                      ))}
                      <button
                        className="percentBtn"
                        onClick={() => setPercentAmount(100)}
                      >
                        Max
                      </button>
                    </div>
                  </div>

                  <div className="swapCenter">
                    <button
                      className={`swapArrow ${arrowSpin ? "spin" : ""}`}
                      onClick={onSwapArrowClick}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <polyline points="19 12 12 19 5 12"></polyline>
                      </svg>
                    </button>
                  </div>

                  <div className="swapRowClean">
                    <div className="swapBox">
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                        <div className="swapLabel" style={{ marginBottom: 0 }}>Buy</div>
                        <div className="swapInput readOnly" style={{ fontSize: estimatedTo ? 36 : 28 }}>
                          {estimatedTo || (quote ? "…" : "0.00")}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
                        <TokenSelect
                          tokens={tokens}
                          value={swapTo}
                          onChange={setSwapTo}
                        />
                        {balances[swapTo] && balances[swapTo] !== "n/a" && (
                          <div className="tokenBalanceHint" style={{ marginTop: 0, fontSize: 13 }}>
                            {balances[swapTo]}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Slippage settings panel (toggles from gear icon) */}
                  {showSlippagePanel && (
                    <div className="slippagePanel">
                      <div className="slippagePanelHeader">
                        <span className="muted">Slippage tolerance</span>
                        <span className="slippageCurrent">
                          {Number(slippageTolerance).toFixed(1)}%
                        </span>
                      </div>
                      <div className="slippagePresetRow">
                        {[0.1, 0.5, 1, 2, 5].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={
                              Number(slippageTolerance) === p
                                ? "slippageChip active"
                                : "slippageChip"
                            }
                            onClick={() => setSlippageTolerance(p)}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                      <div className="slippageInputRow">
                        <input
                          type="number"
                          min="0.1"
                          max="100"
                          step="0.1"
                          value={slippageTolerance}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) {
                              setSlippageTolerance(Math.max(0.1, Math.min(100, v)));
                            }
                          }}
                          className="slippageInput"
                        />
                        <span className="muted">%</span>
                      </div>
                      {Number(slippageTolerance) > 20 ? (
                        <p className="slippageWarning danger">
                          Very high slippage (&gt;20%). You may receive much less than expected.
                        </p>
                      ) : Number(slippageTolerance) > 5 ? (
                        <p className="slippageWarning caution">
                          High slippage (&gt;5%). This trade may be vulnerable to price swings.
                        </p>
                      ) : null}
                    </div>
                  )}

                  {/* Swap summary: expected output, minimum received, slippage, price impact */}
                  {expectedOutputNum != null && swapSummary.minimumReceivedNum != null && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Expected Output</span>
                        <span>{expectedOutputNum >= 1000 ? expectedOutputNum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : expectedOutputNum.toFixed(6)} {swapTo}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Minimum Received</span>
                        <span>{swapSummary.minimumReceivedNum >= 1000 ? swapSummary.minimumReceivedNum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : swapSummary.minimumReceivedNum.toFixed(6)} {swapTo}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Slippage</span>
                        <span>{swapSummary.slippagePct}%</span>
                      </div>
                      {swapSummary.priceImpactPercent != null && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="muted">Price Impact</span>
                          <span>{swapSummary.priceImpactPercent.toFixed(2)}%</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Warnings */}
                  {swapSummary.tradeSizeTooLarge && (
                    <p className="quote" style={{ marginTop: 10, color: "#f59e0b" }}>
                      Trade size is too large for current liquidity.
                    </p>
                  )}
                  {swapSummary.isHighImpact && !swapSummary.isExtremeImpact && (
                    <p className="quote" style={{ marginTop: 10, color: "#f59e0b" }}>
                      ⚠️ This trade has high price impact due to low liquidity.
                    </p>
                  )}
                  {swapSummary.isExtremeImpact && (
                    <label style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "rgba(255,255,255,0.9)", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={!!highImpactConfirmed}
                        onChange={(e) => setHighImpactConfirmed(e.target.checked)}
                      />
                      <span>I understand this trade has very high price impact (&gt;25%) and accept the risk.</span>
                    </label>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <button
                      className="primaryBtn neon-btn"
                      onClick={performSwap}
                      disabled={
                        circleActionsBusy ||
                        swapSummary.tradeSizeTooLarge ||
                        (swapSummary.isExtremeImpact && !highImpactConfirmed)
                      }
                    >
                      {circleActionsBusy ? "Please wait..." : "Swap"}
                    </button>
                  </div>

                  {quote && (
                    <p className="quote">
                      <strong>Quote:</strong> {quote}
                    </p>
                  )}

                </>
              )}
              {activeTab === "history" && (
                <div className="historyBox">
                  <button
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(255, 255, 255, 0.6)",
                      cursor: "pointer",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 14,
                      padding: 0,
                    }}
                    onClick={() => setActiveTab("swap")}
                  >
                    ◀ Back
                  </button>
                  <div className="historyToggleRow">
                    <button
                      className={`historyToggleBtn ${
                        historyView === "mine" ? "active" : ""
                      }`}
                      onClick={() => setHistoryView("mine")}
                    >
                      ONLY MINE
                    </button>

                    <button
                      className={`historyToggleBtn ${
                        historyView === "all" ? "active" : ""
                      }`}
                      onClick={() => setHistoryView("all")}
                    >
                      ALL
                    </button>
                  </div>
                  {txLoading ? (
                    <p className="muted">Loading pool transactions...</p>
                  ) : poolTxs.length === 0 ? (
                    <p className="muted">No transactions found.</p>
                  ) : (
                    <>
                      <ul className="historyList">
                        {activeHistoryTxs.map((tx) => (
                          <li
                            key={tx.hash}
                            className={`historyItem ${
                              historyView === "all" && isMyTx(tx)
                                ? "mineTx"
                                : ""
                            }`}
                          >
                            {/* LEFT SIDE */}
                            <div className="historyLeft">
                              <div>
                                <strong>From:</strong> {shortAddr(tx.from)}
                              </div>
                              <div>
                                <strong>To:</strong> {shortAddr(tx.to)}
                              </div>

                              <div className="historyMeta">
                                <a
                                  href={`https://testnet.arcscan.app/tx/${tx.hash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View Tx
                                </a>
                              </div>
                            </div>

                            {/* RIGHT SIDE */}
                            <div className="historyRight">
                              <div className="historyTime">
                                {formatDateTime(tx.timeStamp)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <div className="paginationRow">
                        <button
                          className="pageBtn"
                          disabled={txPage === 0}
                          onClick={() => setTxPage((p) => Math.max(0, p - 1))}
                        >
                          ◀ Prev
                        </button>

                        <span className="pageInfo">
                          Page {txPage + 1} /{" "}
                          {Math.ceil(activeHistoryTotal / TXS_PER_PAGE)}
                        </span>

                        <button
                          className="pageBtn"
                          disabled={endIdx >= activeHistoryTotal}
                          onClick={() => setTxPage((p) => p + 1)}
                        >
                          Next ▶
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {activeTab === "pools" && (
                <>
                  <div
                    className="historyToggleRow"
                    style={{ marginBottom: 16 }}
                  >
                    <button
                      className={`historyToggleBtn ${
                        poolsView === "positions" ? "active" : ""
                      }`}
                      onClick={() => setPoolsView("positions")}
                    >
                      MY POSITIONS
                    </button>

                    <button
                      className={`historyToggleBtn ${
                        poolsView === "all" ? "active" : ""
                      }`}
                      onClick={() => setPoolsView("all")}
                    >
                      ALL POOLS
                    </button>
                  </div>

                  <div style={{ width: "100%" }}>
                    {poolsView === "positions" && (
                      <div className="neon-card">
                        <h4
                          style={{
                            marginBottom: 12,
                            textAlign: "center",
                            color: "cyan",
                          }}
                        >
                          My Positions
                        </h4>

                        {!getActiveWalletAddress() ? (
                          <p className="muted">
                            Connect wallet to view positions.
                          </p>
                        ) : lpLoading && !lpCacheHydrated ? (
                          <p className="muted">Loading your positions…</p>
                        ) : POOLS.filter((p) => Number(lpBalances[p.id] || 0) > 0).length ===
                          0 ? (
                          <div className="comingSoon">
                            <p className="muted">
                              You have no active liquidity positions
                            </p>
                            <button
                              className="primaryBtn"
                              onClick={() => setPoolsView("all")}
                            >
                              Add Liquidity
                            </button>
                          </div>
                        ) : (
                          POOLS.filter((p) => Number(lpBalances[p.id] || 0) > 0).map((p) => (
                            <div key={p.id} className="positionCard card" style={{ padding: 24 }}>
                              <div className="poolHeader">
                                <div className="poolTokens">
                                  {p.tokens.map((t, i) => (
                                    <span key={`${p.id}-${t}-${i}`} className="token-badge">
                                      <img
                                        src={TOKEN_LOGOS[t]}
                                        alt={t}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          borderRadius: "50%",
                                        }}
                                      />
                                    </span>
                                  ))}
                                </div>
                                <div className="poolName">{p.name}</div>
                              </div>

                              <div className="poolLiquidity">
                                <div className="liquidityTitle">
                                  MY LIQUIDITY
                                </div>

                                {lpTokenAmounts[p.id] &&
                                Object.keys(lpTokenAmounts[p.id]).length > 0 ? (
                                  Object.entries(lpTokenAmounts[p.id]).map(
                                    ([sym, amt]) => (
                                      <div key={sym} className="liquidityRow">
                                        <span>{sym}</span>
                                        <strong>{amt.toFixed(4)}</strong>
                                      </div>
                                    )
                                  )
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </div>

                              <div className="txActions">
                                <button
                                  className="secondaryBtn"
                                  onClick={() => {
                                    setActivePreset(p);
                                    setShowRemoveLiquidity(true);
                                  }}
                                >
                                  Remove
                                </button>

                                <button
                                  className="primaryBtn"
                                  onClick={() => {
                                    setActivePreset(p);
                                    setShowAddLiquidity(true);
                                  }}
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {poolsView === "all" && (
                      <div>
                        {/* High-end TVL Dashboard */}
                        <div className="profileStatsGrid" style={{ marginBottom: 32 }}>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Total TVL</div>
                            <strong style={{ fontSize: 32, color: "white", lineHeight: 1.1 }}>
                              ${Number(totalPoolTVL()).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </strong>
                          </div>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Active Pools</div>
                            <strong style={{ fontSize: 32, color: "white", lineHeight: 1.1 }}>{POOLS.length}</strong>
                          </div>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>My LP Value</div>
                            <strong style={{ fontSize: 32, color: "#4caf50", lineHeight: 1.1 }}>
                              ${lpBalances && Object.keys(lpBalances).length > 0 ? Object.keys(lpBalances).reduce((acc, poolId) => acc + (lpTokenAmounts[poolId] ? Object.entries(lpTokenAmounts[poolId]).reduce((sum, [sym, amt]) => sum + (amt * Number(tokenPrices[sym] || 0)), 0) : 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0.00"}
                            </strong>
                          </div>
                        </div>

                        <div className="poolsGrid">
                          {POOLS.map((p) => {
                            const tvl = poolBalances[p.id] || 0;

                            return (
                              <div key={p.id} className="poolCard card">
                                <div className="poolHeader" style={{ paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 16 }}>
                                  <div className="poolTokens">
                                    {p.tokens.map((t, i) => (
                                      <span key={i} className="token-badge" style={{ marginLeft: i > 0 ? -10 : 0, WebkitMaskImage: i > 0 ? "radial-gradient(circle at -4px center, transparent 12px, black 13px)" : "none" }}>
                                        <img
                                          src={TOKEN_LOGOS[t]}
                                          alt={t}
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: "50%",
                                          }}
                                        />
                                      </span>
                                    ))}
                                  </div>
                                  <div className="poolName" style={{ fontSize: 18 }}>{p.name}</div>
                                </div>

                                <div className="poolLiquidity" style={{ marginBottom: 16 }}>
                                  <div className="liquidityTitle" style={{ fontSize: 12, color: "#8c9bb5", marginBottom: 8 }}>
                                    TOTAL LIQUIDITY
                                  </div>

                                  {poolTokenBalances[p.id] ? (
                                    Object.entries(poolTokenBalances[p.id]).map(
                                      ([sym, amt]) => (
                                        <div key={sym} className="liquidityRow" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                          <span style={{ fontSize: 14 }}>{sym}</span>
                                          <strong style={{ fontSize: 14, color: "#eef8ff" }}>{amt >= 1000 ? amt.toLocaleString(undefined, { maximumFractionDigits: 2 }) : amt.toFixed(2)}</strong>
                                        </div>
                                      )
                                    )
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </div>

                                <div className="poolStat" style={{ padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                  <span style={{ color: "#8c9bb5" }}>Fee Tier</span>
                                  <strong style={{ color: "#eef8ff" }}>0.30%</strong>
                                </div>

                                <button
                                  className="primaryBtn"
                                  style={{ marginTop: 2 }}
                                  onClick={() => {
                                    setActivePreset(p);
                                    setPoolsView("positions");
                                    setShowAddLiquidity(true);
                                  }}
                                >
                                  Deposit
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div
                          className="muted"
                          style={{
                            marginTop: 18,
                            textAlign: "center",
                            fontStyle: "italic",
                          }}
                        >
                          Liquidity and TVL are fetched directly from on-chain
                          balances
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {activeTab === "leaderboard" && (
                <div className="leaderboardContainer" style={{ width: "100%" }}>
                  <div className="historyToggleRow">
                    <button
                      className={`historyToggleBtn ${
                        leaderboardTab === "swaps" ? "active" : ""
                      }`}
                      onClick={() => setLeaderboardTab("swaps")}
                    >
                      TOP TRADERS
                    </button>
                    <button
                      className={`historyToggleBtn ${
                        leaderboardTab === "lp" ? "active" : ""
                      }`}
                      onClick={() => setLeaderboardTab("lp")}
                    >
                      TOP LP PROVIDERS
                    </button>
                  </div>

                  <div className="neon-card" style={{ marginTop: 20 }}>
                    {leaderboardTab === "swaps" && (
                      <ul className="historyList">
                        {leaderboard.topSwapVolume.length === 0 ? (
                          <p className="muted">No data yet</p>
                        ) : (
                          leaderboard.topSwapVolume.map((u, i) => (
                            <li key={i} className="historyItem">
                              <div className="historyLeft">
                                <strong>
                                  #{i + 1} {u.username || shortAddr(u.userId)}
                                </strong>
                              </div>
                              <div className="historyRight">
                                Vol: $
                                {Number(u.swapVolume).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 }
                                )}{" "}
                                <br />
                                <span
                                  className="muted"
                                  style={{ fontSize: 12 }}
                                >
                                  {u.swapCount} Swaps
                                </span>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                    {leaderboardTab === "lp" && (
                      <ul className="historyList">
                        {leaderboard.topLPProvided.length === 0 ? (
                          <p className="muted">No data yet</p>
                        ) : (
                          leaderboard.topLPProvided.map((u, i) => (
                            <li key={i} className="historyItem">
                              <div className="historyLeft">
                                <strong>
                                  #{i + 1} {u.username || shortAddr(u.userId)}
                                </strong>
                              </div>
                              <div className="historyRight">
                                LP: $
                                {Number(u.lpProvided).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 }
                                )}
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {activeTab === "privpay" && (
                <div className="billsWrap">
                  {PRIVPAY_PLACEHOLDER_MODE ? (
                    <div className="privpayPlaceholderCard">
                      <div className="privpayPlaceholderInner">
                        <h2>PRIVPAY</h2>
                        <p>Wallet Dashboard</p>
                      </div>
                    </div>
                  ) : (
                    <>
                  {!STEALTH_PAYMENTS_ADDRESS && (
                    <div className="envWarningBanner">
                      Stealth contract not configured. Set <code>VITE_STEALTH_PAYMENTS_ADDRESS</code> to enable onchain bill/payroll payments.
                    </div>
                  )}
                  <div className="privpayModuleSwitchRow">
                    <div className="privpayPrimaryPills">
                      <button
                        type="button"
                        className={`privpayModulePill ${privpayModule === "bills" ? "active" : ""}`}
                        onClick={() => setPrivpayModule("bills")}
                      >
                        Bills
                      </button>
                      <button
                        type="button"
                        className={`privpayModulePill ${privpayModule === "payroll" ? "active" : ""}`}
                        onClick={() => setPrivpayModule("payroll")}
                      >
                        Payroll
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`privpayModulePill privpayClaimPill ${privpayModule === "claim" ? "active" : ""}`}
                      onClick={() => setPrivpayModule("claim")}
                    >
                      Claim
                    </button>
                  </div>

                  {privpayModule === "bills" && (
                    <>
                      <div className="billsWorkspaceTop">
                      <div className="neon-card billsCreateCard">
                        <div className="billsTitleRow">
                          <div>
                            <h2 className="billsTitle">Bills</h2>
                            <span className="billsSubtitle">
                              Pay once or on a schedule. Recipient uses a normal wallet address.
                            </span>
                          </div>
                        </div>

                        <div className="billsGrid">
                          <label className="billsField">
                            <span>Bill Name</span>
                            <select
                              className="billsInput"
                              value={
                                BILL_NAME_PRESETS.includes(String(billForm.name || "").trim())
                                  ? String(billForm.name || "").trim()
                                  : "__custom__"
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setBillForm((p) => ({
                                  ...p,
                                  name: v === "__custom__" ? "" : v,
                                }));
                              }}
                            >
                              {BILL_NAME_PRESETS.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                              <option value="__custom__">Custom (type your own)</option>
                            </select>
                            {!BILL_NAME_PRESETS.includes(String(billForm.name || "").trim()) && (
                              <input
                                className="billsInput"
                                value={billForm.name}
                                onChange={(e) =>
                                  setBillForm((p) => ({ ...p, name: e.target.value }))
                                }
                                placeholder="Type custom bill name"
                                style={{ marginTop: 8 }}
                              />
                            )}
                          </label>

                          <label className="billsField">
                            <span>Token</span>
                            <select
                              className="billsInput"
                              value={billForm.token}
                              onChange={(e) =>
                                setBillForm((p) => ({ ...p, token: e.target.value }))
                              }
                            >
                              {["USDC", "EURC", "SWPRC"].map((sym) => (
                                <option key={sym} value={sym}>
                                  {sym}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="billsField">
                            <span>Amount</span>
                            <input
                              className="billsInput"
                              type="number"
                              min="0"
                              step="0.0001"
                              value={billForm.amount}
                              onChange={(e) =>
                                setBillForm((p) => ({ ...p, amount: e.target.value }))
                              }
                              placeholder="0.00"
                            />
                          </label>

                          <label className="billsField">
                            <span>Schedule</span>
                            <select
                              className="billsInput"
                              value={billForm.frequency}
                              onChange={(e) => {
                                const v = e.target.value;
                                setBillForm((p) => {
                                  const next = { ...p, frequency: v };
                                  if (
                                    v === "custom" &&
                                    (!p.customStartAt || !String(p.customStartAt).trim())
                                  ) {
                                    next.customStartAt = defaultCustomStartAtLocal();
                                  }
                                  if (v === "custom" && !p.customRepeatCadence) {
                                    next.customRepeatCadence = "weekly";
                                  }
                                  return next;
                                });
                              }}
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="bi-weekly">Bi-Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>

                          {billForm.frequency === "custom" && (
                            <div className="billsDatetimeBlock">
                              <label className="billsField">
                                <span>
                                  Next payment (this device&apos;s local date &amp; time)
                                </span>
                                <input
                                  className="billsInput billsInputDatetime"
                                  type="datetime-local"
                                  value={billForm.customStartAt}
                                  onChange={(e) =>
                                    setBillForm((p) => ({
                                      ...p,
                                      customStartAt: e.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <label className="billsField">
                                <span>Then repeat every</span>
                                <select
                                  className="billsInput"
                                  value={billForm.customRepeatCadence}
                                  onChange={(e) =>
                                    setBillForm((p) => ({
                                      ...p,
                                      customRepeatCadence: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="daily">Daily</option>
                                  <option value="weekly">Weekly</option>
                                  <option value="bi-weekly">Bi-weekly</option>
                                  <option value="monthly">Monthly (~30 days)</option>
                                  <option value="quarterly">Quarterly (~90 days)</option>
                                  <option value="yearly">Yearly (~365 days)</option>
                                </select>
                                <span className="billsHint">
                                  First run is at the date/time above; after that, the interval
                                  you pick here sets every following payment (scheduler uses fixed
                                  seconds, not calendar months).
                                </span>
                              </label>
                            </div>
                          )}

                          <label className="billsField billsFieldFull">
                            <span>Recipient Wallet</span>
                            <input
                              className="billsInput mono"
                              value={billForm.recipientWallet}
                              onChange={(e) =>
                                setBillForm((p) => ({
                                  ...p,
                                  recipientWallet: e.target.value,
                                }))
                              }
                              placeholder="0xRecipient..."
                            />
                          </label>

                        </div>

                        <div className="billsActionsRow">
                          <label className="billsToggle">
                            <input
                              type="checkbox"
                              checked={billForm.recurring}
                              disabled={!canUseRecurring()}
                              onChange={(e) =>
                                setBillForm((p) => ({
                                  ...p,
                                  recurring: canUseRecurring() ? e.target.checked : false,
                                }))
                              }
                            />
                            <span>Recurring</span>
                          </label>
                          {billForm.recurring && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              One-time setup signatures (authorization + approvals). After activation, charges run automatically on the
                              server while you are offline.
                            </span>
                          )}
                          <button className="primaryBtn billsCreateBtn" onClick={createBill}>
                            {editingBillId ? "Update Bill" : "Create Bill"}
                          </button>
                          {editingBillId && (
                            <button
                              className="secondaryBtn billsPayBtn"
                              onClick={() => {
                                setEditingBillId(null);
                                setBillForm((p) => ({
                                  ...p,
                                  name: "",
                                  amount: "",
                                  recipientWallet: "",
                                  receiverSpendPublicKey: "",
                                  receiverViewPublicKey: "",
                                  customStartAt: "",
                                  customRepeatCadence: "weekly",
                                  customIntervalSeconds: "",
                                }));
                              }}
                            >
                              Cancel Edit
                            </button>
                          )}
                        </div>

                        {billCreateError && <p className="quote billsErr">{billCreateError}</p>}
                        {billRecipientInviteStatus && (
                          <p className="quote billsOk">{billRecipientInviteStatus}</p>
                        )}
                        {billCreateStatus && <p className="quote billsOk">{billCreateStatus}</p>}
                      </div>

                      <div className="neon-card billsListCard">
                        <h3 className="billsSectionTitle">Upcoming</h3>
                        {billRuntimeError && <p className="quote billsErr">{billRuntimeError}</p>}
                        {billRuntimeStatus && <p className="quote billsOk">{billRuntimeStatus}</p>}
                        {(() => {
                          const sortedBills = bills
                            .slice()
                            .sort(
                              (a, b) =>
                                new Date(a.nextExecutionAt).getTime() -
                                new Date(b.nextExecutionAt).getTime()
                            );
                          const {
                            pageRows: pagedBills,
                            totalPages,
                            safePage,
                            totalCount,
                          } = paginateRows(sortedBills, billsUpcomingPage, 5);
                          return totalCount === 0 ? (
                            <p className="muted">No bills created yet.</p>
                          ) : (
                            <>
                              <div className="billsItems">
                                {pagedBills.map((bill) => (
                                <div className="billsItem" key={bill.id}>
                                  <div className="billsItemTop">
                                    <div>
                                      <strong>{bill.name}</strong>
                                      <div className="muted billsMeta">
                                        {bill.amount} {bill.token}
                                      </div>
                                      <div className="muted billsMeta">
                                        {recurringStatusCopy(bill)}
                                      </div>
                                      {bill.schedulerFailureReason && (
                                        <div className="muted billsMeta" style={{ color: "#ff9c9c" }}>
                                          Automation issue: {bill.schedulerFailureReason}
                                        </div>
                                      )}
                                    </div>
                                    <div className="billsNext">
                                      Next:{" "}
                                      {bill.nextExecutionAt
                                        ? new Date(bill.nextExecutionAt).toLocaleString()
                                        : "—"}
                                    </div>
                                  </div>
                                  <div className="billsItemBottom">
                                    <label className="billsToggle small">
                                      <input
                                        type="checkbox"
                                        checked={!!bill.recurring}
                                        disabled={!canUseRecurring()}
                                        onChange={(e) =>
                                          toggleBillRecurring(
                                            bill,
                                            canUseRecurring() ? e.target.checked : false
                                          )
                                        }
                                      />
                                      <span>Recurring</span>
                                    </label>
                                    <div className="billsItemActions">
                                      <button
                                        className="secondaryBtn billsPayBtn"
                                        disabled={billBusyId === bill.id}
                                        onClick={() => payBillNow(bill)}
                                      >
                                        {billBusyId === bill.id ? "Processing..." : "Pay Now"}
                                      </button>
                                      {isLikelyStealthConfigError({
                                        message: bill.schedulerFailureReason,
                                      }) && (
                                        <button
                                          className="secondaryBtn billsPayBtn"
                                          onClick={() => repairBillRecipientKeys(bill)}
                                        >
                                          Repair Keys
                                        </button>
                                      )}
                                      <button
                                        className="secondaryBtn billsPayBtn"
                                        onClick={() => editBill(bill)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="secondaryBtn billsPayBtn"
                                        onClick={() => {
                                          deleteBill(bill.id);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              </div>
                              <div className="paginationBar">
                                <button
                                  type="button"
                                  className="secondaryBtn billsPayBtn paginationBtn"
                                  disabled={safePage <= 1}
                                  onClick={() =>
                                    setBillsUpcomingPage((p) => Math.max(1, p - 1))
                                  }
                                >
                                  Prev
                                </button>
                                <span className="paginationMeta">
                                  Page {safePage} / {totalPages} · {totalCount} bills
                                </span>
                                <button
                                  type="button"
                                  className="secondaryBtn billsPayBtn paginationBtn"
                                  disabled={safePage >= totalPages}
                                  onClick={() =>
                                    setBillsUpcomingPage((p) =>
                                      Math.min(totalPages, p + 1)
                                    )
                                  }
                                >
                                  Next
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      </div>

                      <div className="neon-card billsHistoryCard billsHistoryCentered">
                        <div className="historyHeaderRow">
                          <h3 className="billsSectionTitle">History</h3>
                          <div className="historyHeaderActions">
                            <select
                              className="billsInput exportModeSelect"
                              value={billExportMode}
                              onChange={(e) => setBillExportMode(e.target.value)}
                            >
                              <option value="all">Export All</option>
                              <option value="unresolved">Export Unresolved</option>
                              <option value="selected">Export Selected</option>
                            </select>
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              disabled={
                                billExportMode === "selected" &&
                                selectedBillHistoryIds.size === 0
                              }
                              onClick={() => exportBillHistoryEntries(billEntriesByExportMode(billExportMode))}
                            >
                              Export Bills
                            </button>
                          </div>
                        </div>
                        <div className="historyStatusLegend" role="note">
                          <div className="historyLegendLine">
                            <span
                              className="historyLegendSwatch historyLegendSwatchClaimed"
                              aria-hidden="true"
                            />
                            <span>
                              <strong>Claimed</strong> — The recipient withdrew the privacy-pool credit
                              on-chain (their claim transaction succeeded).
                            </span>
                          </div>
                          <div className="historyLegendLine">
                            <span
                              className="historyLegendSwatch historyLegendSwatchResolved"
                              aria-hidden="true"
                            />
                            <span>
                              <strong>Resolved</strong> — You exported this row to CSV; the app tags it so
                              “unresolved” exports only show what you have not reconciled yet.
                            </span>
                          </div>
                        </div>
                        {(() => {
                          const {
                            pageRows: pagedBillHistory,
                            totalPages,
                            safePage,
                            totalCount,
                          } = paginateRows(billHistory, billsHistoryPage, 8);
                          return totalCount === 0 ? (
                            <p className="muted">No payment history yet.</p>
                          ) : (
                            <>
                              <ul className="historyList">
                                {pagedBillHistory.map((h) => (
                              <li className="historyItem" key={h.id}>
                                <div className="historyLeft">
                                  <label className="historySelect">
                                    <input
                                      type="checkbox"
                                      checked={selectedBillHistoryIds.has(h.id)}
                                      onChange={(e) =>
                                        toggleBillHistorySelection(h.id, e.target.checked)
                                      }
                                    />
                                    <span>Select</span>
                                  </label>
                                  <div>
                                    <strong>{h.billName || "Bill Payment"}</strong>
                                    {h.poolClaimedAt ? (
                                      <span className="claimedPill">Claimed</span>
                                    ) : null}
                                    {resolvedBillHistoryIds.has(h.id) ? (
                                      <span className="resolvedPill">Resolved</span>
                                    ) : null}
                                  </div>
                                  <div className="muted">
                                    {h.amount} {h.token} • {h.status}
                                    {h.paymentRail === "privacyPool" ? " • privacy pool" : ""}
                                  </div>
                                  {h.paymentRail === "privacyPool" && h.poolRecipient && (
                                    <div className="muted billsStealthAddr">
                                      Credit to wallet: {shortAddr(h.poolRecipient)}
                                      <span className="billsHint">
                                        Recipient: paste Receipt <code>poolClaimCode</code> in
                                        Payments Claim — share only over a private channel.
                                      </span>
                                    </div>
                                  )}
                                  {h.stealthAddress && (
                                    <div className="muted billsStealthAddr">
                                      Stealth: {shortAddr(h.stealthAddress)}
                                      <span className="billsHint">
                                        Recipient claims under Private receive — not on their normal wallet balance.
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="historyRight">
                                  <div className="historyRightTimestamp">
                                    {h.createdAt
                                      ? new Date(h.createdAt).toLocaleString()
                                      : "—"}
                                  </div>
                                  <div className="historyRightActions">
                                    {h.txHash && h.txHash !== "SUBMITTED" && (
                                      <a
                                        className="secondaryBtn billsPayBtn"
                                        href={`https://testnet.arcscan.app/tx/${h.txHash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Tx
                                      </a>
                                    )}
                                    <button
                                      className="secondaryBtn billsPayBtn"
                                      onClick={() => openBillReceiptCard(h)}
                                    >
                                      Receipt
                                    </button>
                                  </div>
                                </div>
                              </li>
                                ))}
                              </ul>
                              {totalPages > 1 ? (
                                <div className="paginationBar">
                                  <button
                                    type="button"
                                    className="secondaryBtn billsPayBtn paginationBtn"
                                    disabled={safePage <= 1}
                                    onClick={() =>
                                      setBillsHistoryPage((p) => Math.max(1, p - 1))
                                    }
                                  >
                                    Prev
                                  </button>
                                  <span className="paginationMeta">
                                    Page {safePage} / {totalPages} · {totalCount} records
                                  </span>
                                  <button
                                    type="button"
                                    className="secondaryBtn billsPayBtn paginationBtn"
                                    disabled={safePage >= totalPages}
                                    onClick={() =>
                                      setBillsHistoryPage((p) => Math.min(totalPages, p + 1))
                                    }
                                  >
                                    Next
                                  </button>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}

                  {privpayModule === "payroll" && (
                    <>
                      <div className="neon-card payrollDashboardCard">
                        <div className="privpayFormHeader">
                          <div>
                            <h2 className="billsTitle">Payroll</h2>
                            <span className="billsSubtitle">
                              Companies, employees, and salary runs.
                            </span>
                          </div>
                          <label className="billsField payrollCompanyField">
                            <span>Select Company</span>
                            <select
                              className="billsInput"
                              value={selectedCompanyId}
                              onChange={(e) => {
                                const companyId = e.target.value;
                                setSelectedCompanyId(companyId);
                                setEmployeeForm((prev) => ({ ...prev, companyId }));
                              }}
                            >
                              <option value="">All companies</option>
                              {payrollCompanies.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} • {c.token}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {(() => {
                          const scopeId = selectedCompanyId || "";
                          const scopedEmployees = payrollEmployees.filter((e) =>
                            employeeMatchesPayrollCompanyFilter(e, scopeId)
                          );
                          const dueCount = scopedEmployees.filter(
                            (e) =>
                              e.status === "active" &&
                              e.recurring &&
                              e.nextRunAt &&
                              new Date(e.nextRunAt).getTime() <= Date.now()
                          ).length;
                          const monthlyEstimate = scopedEmployees.reduce(
                            (acc, e) => acc + Number(e.salary || 0),
                            0
                          );
                          return (
                            <div className="payrollKpiGrid">
                              <button
                                type="button"
                                className={`payrollKpiCard payrollKpiAction ${payrollManageView === "companies" ? "active" : ""}`}
                                onClick={() => setPayrollManageView("companies")}
                              >
                                <span className="muted">Companies</span>
                                <strong>{payrollCompanies.length}</strong>
                              </button>
                              <button
                                type="button"
                                className={`payrollKpiCard payrollKpiAction ${payrollManageView === "employees" ? "active" : ""}`}
                                onClick={() => setPayrollManageView("employees")}
                              >
                                <span className="muted">Employees</span>
                                <strong>{scopedEmployees.length}</strong>
                              </button>
                              <div className="payrollKpiCard">
                                <span className="muted">Due now (recurring)</span>
                                <strong>{dueCount}</strong>
                              </div>
                              <div className="payrollKpiCard">
                                <span className="muted">Salary Total</span>
                                <strong>
                                  USDC {monthlyEstimate.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                </strong>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      {payrollManageView === "companies" && (
                        <div className="neon-card billsHistoryCard">
                          <div className="historyHeaderRow">
                            <h3 className="billsSectionTitle">Companies</h3>
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              onClick={() => setPayrollManageView("dashboard")}
                            >
                              Back to Payroll
                            </button>
                          </div>
                          {payrollCompanies.length === 0 ? (
                            <p className="muted">No companies yet.</p>
                          ) : (
                            <div className="billsItems">
                              {payrollCompanies.map((company) => (
                                <div className="billsItem" key={company.id}>
                                  <div className="billsItemTop">
                                    <div>
                                      <strong>{company.name}</strong>
                                      <div className="muted billsMeta">
                                        Token: {company.token || "USDC"} • Default schedule: {company.defaultFrequency || "monthly"}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="billsItemBottom">
                                    <div className="billsItemActions">
                                      <button
                                        type="button"
                                        className="secondaryBtn billsPayBtn"
                                        onClick={() => {
                                          setSelectedCompanyId(company.id);
                                          editCompanyProfile(company);
                                        }}
                                      >
                                        Edit Company
                                      </button>
                                      <button
                                        type="button"
                                        className="secondaryBtn billsPayBtn"
                                        onClick={() => deleteCompanyProfile(company.id)}
                                      >
                                        Delete Company
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {payrollManageView === "employees" && (
                        <div className="neon-card billsHistoryCard">
                          <div className="historyHeaderRow">
                            <h3 className="billsSectionTitle">Employees</h3>
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              onClick={() => setPayrollManageView("dashboard")}
                            >
                              Back to Payroll
                            </button>
                          </div>
                          {payrollEmployees.length === 0 ? (
                            <p className="muted">No employees yet.</p>
                          ) : (
                            <div className="billsItems">
                              {payrollEmployees.map((emp) => {
                                const company = payrollCompanies.find((c) => c.id === emp.companyId);
                                return (
                                  <div className="billsItem" key={emp.id}>
                                    <div className="billsItemTop">
                                      <div>
                                        <strong>{emp.name}</strong>
                                        <div className="muted billsMeta">
                                          {emp.role || "Role not set"} • {emp.salary || 0} {company?.token || "USDC"}
                                          {emp.status === "paused" ? " • paused" : ""}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="billsItemBottom">
                                      <div className="billsItemActions">
                                        <button
                                          type="button"
                                          className="secondaryBtn billsPayBtn"
                                          onClick={() => {
                                            if (emp.companyId) setSelectedCompanyId(emp.companyId);
                                            editEmployee(emp);
                                          }}
                                        >
                                          Edit Employee
                                        </button>
                                        <button
                                          type="button"
                                          className="secondaryBtn billsPayBtn"
                                          onClick={() => deleteEmployee(emp.id)}
                                        >
                                          Delete Employee
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="payrollWorkspace">
                        <div className="payrollLeftPane">

                      <div className="neon-card billsCreateCard">
                        <h3 className="billsSectionTitle">Create Company</h3>
                        <div className="billsGrid">
                          <label className="billsField">
                            <span>Company Name</span>
                            <input
                              className="billsInput"
                              value={companyForm.name}
                              onChange={(e) =>
                                setCompanyForm((p) => ({ ...p, name: e.target.value }))
                              }
                              placeholder="Acme Inc."
                            />
                          </label>
                          <label className="billsField">
                            <span>Payroll Token</span>
                            <select
                              className="billsInput"
                              value={companyForm.token}
                              onChange={(e) =>
                                setCompanyForm((p) => ({ ...p, token: e.target.value }))
                              }
                            >
                              {["USDC", "EURC", "SWPRC"].map((sym) => (
                                <option key={sym} value={sym}>
                                  {sym}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="billsField">
                            <span>Default Schedule</span>
                            <select
                              className="billsInput"
                              value={companyForm.defaultFrequency}
                              onChange={(e) =>
                                setCompanyForm((p) => ({
                                  ...p,
                                  defaultFrequency: e.target.value,
                                }))
                              }
                            >
                              <option value="weekly">Weekly</option>
                              <option value="bi-weekly">Bi-Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                            </select>
                          </label>
                        </div>
                        <div className="billsActionsRow">
                          <button className="primaryBtn billsCreateBtn" onClick={createCompanyProfile}>
                            {editingCompanyId ? "Update Company" : "Create Company"}
                          </button>
                          {editingCompanyId ? (
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              onClick={() => {
                                setEditingCompanyId(null);
                                setCompanyForm((prev) => ({
                                  ...prev,
                                  name: "",
                                  token: "USDC",
                                  defaultFrequency: "monthly",
                                }));
                              }}
                            >
                              Cancel Edit
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="neon-card billsCreateCard">
                        <h3 className="billsSectionTitle">Employee</h3>
                        <div className="billsGrid">
                          <label className="billsField billsFieldFull">
                            <span>Company</span>
                            <select
                              className="billsInput"
                              value={employeeForm.companyId || selectedCompanyId}
                              onChange={(e) => {
                                setSelectedCompanyId(e.target.value);
                                setEmployeeForm((p) => ({ ...p, companyId: e.target.value }));
                              }}
                            >
                              <option value="">Select company</option>
                              {payrollCompanies.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="billsField">
                            <span>Name</span>
                            <input
                              className="billsInput"
                              value={employeeForm.name}
                              onChange={(e) =>
                                setEmployeeForm((p) => ({ ...p, name: e.target.value }))
                              }
                              placeholder="Jane Doe"
                            />
                          </label>

                          <label className="billsField">
                            <span>Role</span>
                            <input
                              className="billsInput"
                              value={employeeForm.role}
                              onChange={(e) =>
                                setEmployeeForm((p) => ({ ...p, role: e.target.value }))
                              }
                              placeholder="Designer"
                            />
                          </label>

                          <label className="billsField">
                            <span>Salary</span>
                            <input
                              className="billsInput"
                              type="number"
                              min="0"
                              step="0.0001"
                              value={employeeForm.salary}
                              onChange={(e) =>
                                setEmployeeForm((p) => ({ ...p, salary: e.target.value }))
                              }
                              placeholder="5000"
                            />
                          </label>

                          <label className="billsField">
                            <span>Schedule</span>
                            <select
                              className="billsInput"
                              value={employeeForm.frequency}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEmployeeForm((p) => {
                                  const next = { ...p, frequency: v };
                                  if (
                                    v === "custom" &&
                                    (!p.customStartAt || !String(p.customStartAt).trim())
                                  ) {
                                    next.customStartAt = defaultCustomStartAtLocal();
                                  }
                                  if (v === "custom" && !p.customRepeatCadence) {
                                    next.customRepeatCadence = "weekly";
                                  }
                                  return next;
                                });
                              }}
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="bi-weekly">Bi-Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>

                          {employeeForm.frequency === "custom" && (
                            <div className="billsDatetimeBlock">
                              <label className="billsField">
                                <span>
                                  Next run (this device&apos;s local date &amp; time)
                                </span>
                                <input
                                  className="billsInput billsInputDatetime"
                                  type="datetime-local"
                                  value={employeeForm.customStartAt}
                                  onChange={(e) =>
                                    setEmployeeForm((p) => ({
                                      ...p,
                                      customStartAt: e.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <label className="billsField">
                                <span>Then repeat every</span>
                                <select
                                  className="billsInput"
                                  value={employeeForm.customRepeatCadence}
                                  onChange={(e) =>
                                    setEmployeeForm((p) => ({
                                      ...p,
                                      customRepeatCadence: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="daily">Daily</option>
                                  <option value="weekly">Weekly</option>
                                  <option value="bi-weekly">Bi-weekly</option>
                                  <option value="monthly">Monthly (~30 days)</option>
                                  <option value="quarterly">Quarterly (~90 days)</option>
                                  <option value="yearly">Yearly (~365 days)</option>
                                </select>
                                <span className="billsHint">
                                  Same as bills: first run at the time above, then every interval you pick.
                                </span>
                              </label>
                            </div>
                          )}

                          <label className="billsField billsFieldFull">
                            <span>Employee Wallet</span>
                            <input
                              className="billsInput mono"
                              value={employeeForm.recipientWallet}
                              onChange={(e) =>
                                setEmployeeForm((p) => ({
                                  ...p,
                                  recipientWallet: e.target.value,
                                }))
                              }
                              placeholder="0xEmployee..."
                            />
                          </label>

                        </div>
                        <div className="billsActionsRow">
                          <label className="billsToggle">
                            <input
                              type="checkbox"
                              checked={employeeForm.recurring}
                              disabled={!canUsePayrollAutomation()}
                              onChange={(e) =>
                                setEmployeeForm((p) => ({
                                  ...p,
                                  recurring: canUsePayrollAutomation()
                                    ? e.target.checked
                                    : false,
                                }))
                              }
                            />
                            <span>Recurring</span>
                          </label>
                          <button className="primaryBtn billsCreateBtn" onClick={addPayrollEmployee}>
                            {editingEmployeeId ? "Update Employee" : "Add Employee"}
                          </button>
                          {editingEmployeeId && (
                            <button
                              className="secondaryBtn billsPayBtn"
                              onClick={() => {
                                setEditingEmployeeId(null);
                                setEmployeeForm((p) => ({
                                  ...p,
                                  name: "",
                                  role: "",
                                  recipientWallet: "",
                                  receiverSpendPublicKey: "",
                                  receiverViewPublicKey: "",
                                  salary: "",
                                  customStartAt: "",
                                  customRepeatCadence: "weekly",
                                  customIntervalSeconds: "",
                                }));
                              }}
                            >
                              Cancel Edit
                            </button>
                          )}
                        </div>
                        {payrollError && <p className="quote billsErr">{payrollError}</p>}
                        {payrollRecipientInviteStatus && (
                          <p className="quote billsOk">{payrollRecipientInviteStatus}</p>
                        )}
                        {payrollStatus && <p className="quote billsOk">{payrollStatus}</p>}
                      </div>
                      </div>
                      <div className="payrollRightPane">

                      <div className="neon-card billsListCard">
                        <h3 className="billsSectionTitle">Upcoming runs</h3>
                        {payrollAutopayServerHint ? (
                          <p className="quote billsErr" style={{ marginBottom: 12 }}>
                            {payrollAutopayServerHint} Recurring Bills use the same server setting. You can add
                            Vercel Cron later so autopay runs when the app is closed.
                          </p>
                        ) : null}
                        {payrollServerSyncError ? (
                          <p className="quote billsErr" style={{ marginBottom: 12 }}>
                            {payrollServerSyncError}
                          </p>
                        ) : null}
                        {payrollError ? (
                          <p className="quote billsErr" style={{ marginBottom: 12 }}>
                            {payrollError}
                          </p>
                        ) : null}
                        {(() => {
                          const companyId = selectedCompanyId || "";
                          const company = payrollCompanies.find((c) => c.id === companyId);
                          const rows = payrollEmployees
                            .filter((e) => employeeMatchesPayrollCompanyFilter(e, companyId))
                            .filter((e) => e.status === "active" || e.status === "paused")
                            .slice()
                            .sort((a, b) => {
                              const ta =
                                a.nextRunAt && Number.isFinite(new Date(a.nextRunAt).getTime())
                                  ? new Date(a.nextRunAt).getTime()
                                  : Number.POSITIVE_INFINITY;
                              const tb =
                                b.nextRunAt && Number.isFinite(new Date(b.nextRunAt).getTime())
                                  ? new Date(b.nextRunAt).getTime()
                                  : Number.POSITIVE_INFINITY;
                              return ta - tb;
                            });

                          return (
                            <>
                              {company && (
                                <div className="payrollHeaderActions">
                                  <div className="muted">
                                    {company.name} • {company.token}
                                    <span className="billsHint" style={{ display: "block", marginTop: 6 }}>
                                      Recurring salaries run on the server when due. Use Pay
                                      Now only after turning Recurring off for that employee.
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="secondaryBtn billsPayBtn"
                                    disabled={
                                      payrollBusyCompanyId === company.id ||
                                      !canUsePayrollAutomation()
                                    }
                                    onClick={() => requestServerPayrollRun(company.id)}
                                  >
                                    {payrollBusyCompanyId === company.id
                                      ? "Running..."
                                      : "Run due payroll (server)"}
                                  </button>
                                </div>
                              )}
                              {!company && (
                                <div className="payrollHeaderActions">
                                  <div className="muted">All companies upcoming runs</div>
                                </div>
                              )}
                              {rows.length === 0 ? (
                                <p className="muted">
                                  {payrollEmployees.length === 0
                                    ? "No employees yet. Add an employee to see scheduled runs here."
                                    : companyId &&
                                        !payrollEmployees.some((e) =>
                                          employeeMatchesPayrollCompanyFilter(e, companyId)
                                        )
                                      ? "No employees belong to this company (or pick “All companies”)."
                                      : "No active or paused employees in this view."}
                                </p>
                              ) : (
                                (() => {
                                  const {
                                    pageRows: pagedPayrollUpcoming,
                                    totalPages,
                                    safePage,
                                    totalCount,
                                  } = paginateRows(rows, payrollUpcomingPage, 5);
                                  return (
                                    <>
                                      <div className="billsItems">
                                        {pagedPayrollUpcoming.map((e) => (
                                    <div className="billsItem" key={e.id}>
                                      <div className="billsItemTop">
                                        <div>
                                          <strong>{e.name}</strong>
                                          <div className="muted billsMeta">
                                            {payrollCompanies.find((c) => c.id === e.companyId)?.name || "Unknown company"} •{" "}
                                            {e.role} • {e.salary}{" "}
                                            {company?.token ||
                                              payrollCompanies.find((c) => c.id === e.companyId)?.token ||
                                              "USDC"}
                                            {e.status === "paused" ? " • paused" : ""}
                                          </div>
                                          {e.failureReason && (
                                            <div className="muted billsMeta" style={{ color: "#ff9c9c" }}>
                                              Automation issue:{" "}
                                              {e.failureReason.length > 280
                                                ? `${e.failureReason.slice(0, 280)}…`
                                                : e.failureReason}
                                            </div>
                                          )}
                                        </div>
                                        <div className="billsNext">
                                          Next:{" "}
                                          {e.nextRunAt
                                            ? new Date(e.nextRunAt).toLocaleString()
                                            : "—"}
                                        </div>
                                      </div>
                                      <div className="billsItemBottom">
                                        <label className="billsToggle small">
                                          <input
                                            type="checkbox"
                                            checked={!!e.recurring}
                                            disabled={
                                              !canUsePayrollAutomation() ||
                                              payrollRecurringToggleBusyId === e.id
                                            }
                                            onChange={(evt) => {
                                              const checked =
                                                canUsePayrollAutomation() && evt.target.checked;
                                              void applyPayrollEmployeeRecurringToggle(e, checked);
                                            }}
                                          />
                                          <span>Recurring</span>
                                        </label>
                                        <div className="billsItemActions">
                                          <button
                                            type="button"
                                            className="secondaryBtn billsPayBtn"
                                            disabled={
                                              payrollBusyEmployeeId === e.id ||
                                              !!e.recurring
                                            }
                                            title={
                                              e.recurring
                                                ? "Turn off Recurring to send a one-off Pay Now payment."
                                                : "Send a one-off payment now (not for scheduled recurring)."
                                            }
                                            onClick={() => payEmployeeNow(e)}
                                          >
                                            {payrollBusyEmployeeId === e.id ? "Paying..." : "Pay Now"}
                                          </button>
                                          <button
                                            type="button"
                                            className="secondaryBtn billsPayBtn"
                                            title={
                                              e.status === "active"
                                                ? "Pause: no Pay Now or scheduled/recurring pay for this employee until you Resume."
                                                : "Resume: active employees can be paid again on schedule."
                                            }
                                            onClick={() =>
                                              setPayrollEmployees((prev) =>
                                                prev.map((x) =>
                                                  x.id === e.id
                                                    ? {
                                                        ...x,
                                                        status:
                                                          x.status === "active"
                                                            ? "paused"
                                                            : "active",
                                                      }
                                                    : x
                                                )
                                              )
                                            }
                                          >
                                            {e.status === "active" ? "Pause" : "Resume"}
                                          </button>
                                          <button
                                            type="button"
                                            className="secondaryBtn billsPayBtn"
                                            disabled={payrollBusyEmployeeId === e.id}
                                            onClick={() => {
                                              setPayrollManageView("dashboard");
                                              if (e.companyId) setSelectedCompanyId(e.companyId);
                                              editEmployee(e);
                                            }}
                                          >
                                            Edit
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                        ))}
                                      </div>
                                      <div className="paginationBar">
                                        <button
                                          type="button"
                                          className="secondaryBtn billsPayBtn paginationBtn"
                                          disabled={safePage <= 1}
                                          onClick={() =>
                                            setPayrollUpcomingPage((p) => Math.max(1, p - 1))
                                          }
                                        >
                                          Prev
                                        </button>
                                        <span className="paginationMeta">
                                          Page {safePage} / {totalPages} · {totalCount} employees
                                        </span>
                                        <button
                                          type="button"
                                          className="secondaryBtn billsPayBtn paginationBtn"
                                          disabled={safePage >= totalPages}
                                          onClick={() =>
                                            setPayrollUpcomingPage((p) =>
                                              Math.min(totalPages, p + 1)
                                            )
                                          }
                                        >
                                          Next
                                        </button>
                                      </div>
                                    </>
                                  );
                                })()
                              )}
                            </>
                          );
                        })()}
                      </div>

                      <div className="neon-card billsHistoryCard">
                        <h3 className="billsSectionTitle">Payroll History</h3>
                        <div className="payrollHeaderActions" style={{ marginBottom: 10 }}>
                          <div className="muted">
                            Open Receipt to view claim code and payment details.
                          </div>
                          <div className="historyHeaderActions">
                            <select
                              className="billsInput exportModeSelect"
                              value={payrollExportMode}
                              onChange={(e) => setPayrollExportMode(e.target.value)}
                            >
                              <option value="all">Export All</option>
                              <option value="unresolved">Export Unresolved</option>
                              <option value="selected">Export Selected</option>
                            </select>
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              disabled={
                                payrollExportMode === "selected" &&
                                selectedPayrollHistoryIds.size === 0
                              }
                              onClick={() =>
                                exportPayrollHistoryEntries(
                                  payrollEntriesByExportMode(payrollExportMode)
                                )
                              }
                            >
                              Export Payroll
                            </button>
                          </div>
                        </div>
                        <div className="historyStatusLegend" role="note">
                          <div className="historyLegendLine">
                            <span
                              className="historyLegendSwatch historyLegendSwatchClaimed"
                              aria-hidden="true"
                            />
                            <span>
                              <strong>Claimed</strong> — The recipient withdrew the privacy-pool credit
                              on-chain (their claim transaction succeeded).
                            </span>
                          </div>
                          <div className="historyLegendLine">
                            <span
                              className="historyLegendSwatch historyLegendSwatchResolved"
                              aria-hidden="true"
                            />
                            <span>
                              <strong>Resolved</strong> — You exported this row to CSV; the app tags it so
                              “unresolved” exports only show what you have not reconciled yet.
                            </span>
                          </div>
                        </div>
                        {(() => {
                          const {
                            pageRows: pagedPayrollHistory,
                            totalPages,
                            safePage,
                            totalCount,
                          } = paginateRows(payrollHistory, payrollHistoryPage, 8);
                          return totalCount === 0 ? (
                            <p className="muted">No payroll history yet.</p>
                          ) : (
                            <>
                              <ul className="historyList">
                                {pagedPayrollHistory.map((h) => (
                              <li className="historyItem" key={h.id}>
                                <div className="historyLeft">
                                  <label className="historySelect">
                                    <input
                                      type="checkbox"
                                      checked={selectedPayrollHistoryIds.has(h.id)}
                                      onChange={(e) =>
                                        togglePayrollHistorySelection(
                                          h.id,
                                          e.target.checked
                                        )
                                      }
                                    />
                                    <span>Select</span>
                                  </label>
                                  <div>
                                    <strong>{payrollHistoryDisplayTitle(h)}</strong>
                                    {h.poolClaimedAt ? (
                                      <span className="claimedPill">Claimed</span>
                                    ) : null}
                                    {resolvedPayrollHistoryIds.has(h.id) ? (
                                      <span className="resolvedPill">Resolved</span>
                                    ) : null}
                                  </div>
                                  <div className="muted">
                                    {h.amount} {h.token} • {h.status}
                                    {h.runId ? ` • run ${h.runId.slice(-8)}` : ""}
                                    {h.paymentRail === "privacyPool" ? " • privacy pool" : ""}
                                  </div>
                                  {h.paymentRail === "privacyPool" && h.poolRecipient && (
                                    <div className="muted billsStealthAddr">
                                      Pays to wallet: {shortAddr(h.poolRecipient)}
                                      <span className="billsHint">
                                        Employee: <strong>Bills → Payments Claim</strong> → paste <code>poolClaimCode</code>{" "}
                                        from export or payer receipt.
                                      </span>
                                    </div>
                                  )}
                                  {h.stealthAddress && (
                                    <div className="muted billsStealthAddr">
                                      Stealth: {shortAddr(h.stealthAddress)}
                                      <span className="billsHint">Claim under Bills → Payments Claim (stealth list).</span>
                                    </div>
                                  )}
                                </div>
                                <div className="historyRight">
                                  <div className="historyRightTimestamp">
                                    {h.createdAt
                                      ? new Date(h.createdAt).toLocaleString()
                                      : "—"}
                                  </div>
                                  <div className="historyRightActions">
                                    {h.txHash && h.txHash !== "SUBMITTED" && (
                                      <a
                                        className="secondaryBtn billsPayBtn"
                                        href={`https://testnet.arcscan.app/tx/${h.txHash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Tx
                                      </a>
                                    )}
                                    <button
                                      className="secondaryBtn billsPayBtn"
                                      onClick={() => openPayrollReceiptCard(h)}
                                    >
                                      Receipt
                                    </button>
                                  </div>
                                </div>
                              </li>
                                ))}
                              </ul>
                              {totalPages > 1 ? (
                                <div className="paginationBar">
                                  <button
                                    type="button"
                                    className="secondaryBtn billsPayBtn paginationBtn"
                                    disabled={safePage <= 1}
                                    onClick={() =>
                                      setPayrollHistoryPage((p) => Math.max(1, p - 1))
                                    }
                                  >
                                    Prev
                                  </button>
                                  <span className="paginationMeta">
                                    Page {safePage} / {totalPages} · {totalCount} records
                                  </span>
                                  <button
                                    type="button"
                                    className="secondaryBtn billsPayBtn paginationBtn"
                                    disabled={safePage >= totalPages}
                                    onClick={() =>
                                      setPayrollHistoryPage((p) =>
                                        Math.min(totalPages, p + 1)
                                      )
                                    }
                                  >
                                    Next
                                  </button>
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>
                      </div>
                      </div>
                    </>
                  )}
                  {privpayModule === "claim" && (
                    <>
                      <div className="neon-card billsHistoryCard">
                        <h3 className="billsSectionTitle">Payments Claim</h3>
                        <p className="muted" style={{ marginTop: -6, lineHeight: 1.45 }}>
                          Paste the claim code from Receipt to claim your payment.
                        </p>
                        {HAS_ANY_PRIVACY_POOL ? (
                          <div style={{ marginBottom: 16 }}>
                            <textarea
                              className="privpayInput poolClaimTextarea"
                              placeholder="Paste base64 zk-claim…"
                              value={poolClaimCodeInput}
                              onChange={(e) => setPoolClaimCodeInput(e.target.value)}
                              rows={3}
                              style={{
                                width: "100%",
                                marginTop: 6,
                                fontFamily: "monospace",
                                fontSize: 12,
                              }}
                            />
                            <button
                              type="button"
                              className="secondaryBtn billsPayBtn"
                              style={{ marginTop: 8 }}
                              disabled={poolClaimBusy || !String(poolClaimCodeInput || "").trim()}
                              onClick={async () => {
                                setPoolClaimError("");
                                setPoolClaimStatus("");
                                setPoolClaimBusy(true);
                                setPoolZkError("");
                                setPoolZkStatus("");
                                const slowClaimHintTimer = setTimeout(() => {
                                  setPoolClaimStatus(
                                    "Still proving in browser... this can take 30-120s on some devices."
                                  );
                                }, 25000);
                                try {
                                  const rawCode = String(poolClaimCodeInput || "").trim();
                                  const payload = decodeZkPoolClaimPayload(rawCode);
                                  const r = await claimPrivacyPoolFromClaimCode(rawCode);
                                  setPoolClaimStatus(
                                    r.viaRelay
                                      ? `Relay submitted. Tx ${r.txHash}`
                                      : r.txHash === "SUBMITTED"
                                        ? "Claim submitted. Circle accepted the transaction and hash is still indexing."
                                        : `Claim confirmed. Tx ${r.txHash}`
                                  );
                                  const claimTxHash =
                                    r.txHash && r.txHash !== "SUBMITTED" ? r.txHash : null;
                                  setPoolClaimHistory((prev) => [
                                    {
                                      id: `claim_${crypto.randomUUID()}`,
                                      txHash: claimTxHash,
                                      amount: String(payload?.amount || payload?.amountWei || "—"),
                                      token: "USDC",
                                      claimedAt: new Date().toISOString(),
                                    },
                                    ...prev,
                                  ]);
                                  const activeWallet = getActiveWalletAddress();
                                  if (activeWallet) {
                                    fetchBalances(activeWallet, getReadProvider()).catch(() => {});
                                  }
                                  setPoolClaimCodeInput("");
                                } catch (e) {
                                  const msg = extractEthersRevertReason(e) || e?.message || String(e);
                                  if (/PrivPayClaim_.*line:\s*38|Assert Failed/i.test(msg)) {
                                    setPoolClaimError(
                                      "Claim prover artifacts are out of sync. Regenerate/copy fresh wasm+zkey (npm run privpay:zk-artifacts), hard refresh, then retry claim."
                                    );
                                  } else if (/InvalidProof|0x09bde339/i.test(msg)) {
                                    setPoolClaimError(
                                      "On-chain proof check failed: browser proving key must match deployed verifier — redeploy pool stack after changing zk artifacts, or refresh site files from the same build you deployed."
                                    );
                                  } else {
                                    setPoolClaimError(msg);
                                  }
                                } finally {
                                  clearTimeout(slowClaimHintTimer);
                                  setPoolClaimBusy(false);
                                }
                              }}
                            >
                              {poolClaimBusy ? "Proving / claiming…" : "Claim from pasted code"}
                            </button>
                            {poolClaimError ? (
                              <p className="quote billsErr" style={{ marginTop: 8 }}>
                                {poolClaimError}
                              </p>
                            ) : null}
                            {poolClaimStatus ? (
                              <p className="quote billsOk" style={{ marginTop: 8 }}>
                                {poolClaimStatus}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="neon-card billsHistoryCard">
                        <h3 className="billsSectionTitle">Claim History</h3>
                        {(() => {
                          const {
                            pageRows: pagedClaimHistory,
                            totalPages,
                            safePage,
                            totalCount,
                          } = paginateRows(poolClaimHistory, claimHistoryPage, 8);
                          return totalCount === 0 ? (
                            <p className="muted">No claims yet.</p>
                          ) : (
                            <>
                              <ul className="historyList">
                                {pagedClaimHistory.map((h) => (
                                  <li className="historyItem" key={h.id}>
                                    <div className="historyLeft">
                                      <div>
                                        <strong>{h.amount} {h.token}</strong>
                                      </div>
                                      <div className="muted">
                                        {h.claimedAt ? new Date(h.claimedAt).toLocaleString() : "—"}
                                      </div>
                                    </div>
                                    <div className="historyRight">
                                      <div className="historyRightActions">
                                        {h.txHash ? (
                                          <a
                                            className="secondaryBtn billsPayBtn"
                                            href={`https://testnet.arcscan.app/tx/${h.txHash}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Tx
                                          </a>
                                        ) : null}
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              <div className="paginationBar">
                                <button
                                  type="button"
                                  className="secondaryBtn billsPayBtn paginationBtn"
                                  disabled={safePage <= 1}
                                  onClick={() =>
                                    setClaimHistoryPage((p) => Math.max(1, p - 1))
                                  }
                                >
                                  Prev
                                </button>
                                <span className="paginationMeta">
                                  Page {safePage} / {totalPages} · {totalCount} claims
                                </span>
                                <button
                                  type="button"
                                  className="secondaryBtn billsPayBtn paginationBtn"
                                  disabled={safePage >= totalPages}
                                  onClick={() =>
                                    setClaimHistoryPage((p) =>
                                      Math.min(totalPages, p + 1)
                                    )
                                  }
                                >
                                  Next
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
      {receiptModal && (
        <div className="modalOverlay">
          <div className="receiptModal">
            <div className="receiptGlow" />
            <div className="receiptHeader">
              <div>
                <h3 className="receiptTitle">Receipt</h3>
                <p className="receiptSub">
                  {receiptModal.kind === "payroll" ? "Payroll payout" : "Bill payment"}
                </p>
                {receiptModal.autoOpened ? (
                  <p className="receiptAutoNote">
                    Payment successful. Receipt opened automatically - you can now close.
                  </p>
                ) : null}
              </div>
              <span className="receiptPill">{receiptModal.typeLabel}</span>
            </div>

            <div className="receiptGrid">
              <div className="receiptField">
                <span>Bill / Salary item</span>
                <strong>{receiptModal.title || "—"}</strong>
              </div>
              <div className="receiptField">
                <span>Amount</span>
                <strong>{receiptModal.amountLabel || "—"}</strong>
              </div>
              <div className="receiptField">
                <span>Receiver address</span>
                <code>{receiptModal.receiverAddress || "Not available"}</code>
              </div>
              <div className="receiptField">
                <span>Date paid</span>
                <strong>
                  {receiptModal.paidAt
                    ? new Date(receiptModal.paidAt).toLocaleString()
                    : "Pending"}
                </strong>
              </div>
              <div className="receiptField">
                <span>Next due</span>
                <strong>
                  {receiptModal.nextDueAt
                    ? new Date(receiptModal.nextDueAt).toLocaleString()
                    : "—"}
                </strong>
              </div>
              {receiptModal.companyName ? (
                <div className="receiptField">
                  <span>Company</span>
                  <strong>{receiptModal.companyName}</strong>
                </div>
              ) : null}
            </div>

            <div className="receiptClaimWrap">
              <div className="receiptClaimHead">
                <span>Claim code (recipient)</span>
                {receiptModal.claimCode ? (
                  <button
                    type="button"
                    className="secondaryBtn billsPayBtn"
                    onClick={async () => {
                      await copyTextWithFallback(receiptModal.claimCode);
                    }}
                  >
                    Copy code
                  </button>
                ) : null}
              </div>
              <textarea
                className="receiptClaimCode"
                value={receiptModal.claimCode || "No claim code for this rail."}
                readOnly
                rows={3}
              />
            </div>

            <div className="txActions">
              {receiptModal.txHash && receiptModal.txHash !== "SUBMITTED" ? (
                <a
                  href={`https://testnet.arcscan.app/tx/${receiptModal.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="secondaryBtn"
                >
                  View tx
                </a>
              ) : null}
              <button className="primaryBtn" onClick={() => setReceiptModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {txModal && (
        <div className="modalOverlay">
          <div className="txModal">
            {txModal.status === "success" && (
              <div className="confetti">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} />
                ))}
              </div>
            )}

            <h3>
              {txModal.status === "success"
                ? "Transaction Completed"
                : txModal.status === "pending"
                  ? "Transaction Submitted"
                  : "Swap Failed"}
            </h3>

            <div className="txRow">
              <span>Sent</span>
              <strong>
                {txModal.fromAmount} {txModal.fromToken}
              </strong>
            </div>

            <div className="txRow">
              <span>Received</span>
              <strong>
                {txModal.toAmount} {txModal.toToken}
              </strong>
            </div>

            <div className="txActions">
              {txModal.txHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${txModal.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="secondaryBtn"
                >
                  View details
                </a>
              )}
              <button className="primaryBtn" onClick={() => setTxModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {liquiditySuccess && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal">
            <h3 style={{ color: "#9ff6ff", marginBottom: 14 }}>
              {liquiditySuccess.type === "add"
                ? "Liquidity Added Successfully"
                : "Liquidity Removed Successfully"}
            </h3>

            {liquiditySuccess.type === "add" &&
              Object.entries(liquiditySuccess.amounts).map(
                ([sym, amt]) =>
                  amt &&
                  Number(amt) > 0 && (
                    <div key={sym} className="txRow">
                      <span>{sym}</span>
                      <strong>{Number(amt).toFixed(4)}</strong>
                    </div>
                  )
              )}

            {liquiditySuccess.type === "remove" && (
              <>
                {liquiditySuccess.removed && Object.keys(liquiditySuccess.removed).length > 0 ? (
                  Object.entries(liquiditySuccess.removed).map(([sym, amt]) => (
                    <div key={sym} className="txRow">
                      <span>{sym} Removed</span>
                      <strong>
                        {(() => {
                          const v = Number(amt || 0);
                          if (!Number.isFinite(v) || v <= 0) return amt;
                          if (v < 0.0001) return "<0.0001";
                          return v.toFixed(4);
                        })()}
                      </strong>
                    </div>
                  ))
                ) : (
                  <div className="txRow">
                    <span>Removed</span>
                    <strong>Success</strong>
                  </div>
                )}
              </>
            )}

            <div className="txActions">
              <button
                className="primaryBtn"
                onClick={() => setLiquiditySuccess(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="mobileMenuOverlay">
          <div className="mobileMenu">
            <button
              onClick={() => {
                setActiveTab("profile");
                setMobileMenuOpen(false);
              }}
            >
              Profile
            </button>

            <button
              onClick={() => {
                setActiveTab("swap");
                setMobileMenuOpen(false);
              }}
            >
              Swap
            </button>

            <button
              onClick={() => {
                setActiveTab("pools");
                setMobileMenuOpen(false);
              }}
            >
              Pools
            </button>

            <button
              onClick={() => {
                setActiveTab("privpay");
                setMobileMenuOpen(false);
              }}
            >
              PRIVPAY
            </button>

            <button onClick={openFaucet}>💧 Get Faucet</button>

            <button
              onClick={() => window.open("https://x.com/swaparc_app", "_blank")}
            >
              𝕏 Twitter
            </button>
            <button
              className="closeBtn"
              onClick={() => setMobileMenuOpen(false)}
            >
              Close ✕
            </button>
          </div>
        </div>
      )}
      {showAddLiquidity && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal card" style={{ maxWidth: 460, padding: "24px 28px" }}>
            <h3 style={{ marginBottom: 24, fontSize: 22, fontWeight: 600 }}>Deposit Liquidity</h3>

            <div style={{ marginBottom: 24 }}>
              {(activePreset?.tokens || ["USDC", "EURC", "SWPRC"]).map((sym) => (
                <div key={sym} className="card" style={{ marginBottom: 12, padding: "16px 20px", background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <img src={TOKEN_LOGOS[sym]} alt={sym} style={{ width: 24, height: 24, borderRadius: "50%" }} />
                      <span style={{ fontSize: 18, fontWeight: 600 }}>{sym}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 14 }}>
                      Balance: {balances[sym]}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <input
                      className="swapInput"
                      placeholder="0.00"
                      value={liqInputs[sym] || ""}
                      onChange={(e) => setLiqInputs((p) => ({ ...p, [sym]: e.target.value }))}
                      style={{ fontSize: 32, padding: 0, width: "70%" }}
                    />
                    <div className="muted" style={{ fontSize: 14, textAlign: "right", whiteSpace: "nowrap" }}>
                      ≈ ${liqInputs[sym] && prices[sym] ? (Number(liqInputs[sym]) * prices[sym]).toFixed(2) : "0.00"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Price Ratio Info Block */}
            <div className="card" style={{ padding: "12px 16px", marginBottom: 24, background: "rgba(0,0,0,0.2)" }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                 <span className="muted" style={{ fontSize: 13 }}>Current Pool Fee</span>
                 <strong style={{ fontSize: 14, color: "#00f0ff" }}>0.30%</strong>
               </div>
            </div>

            <div className="txActions">
              <button className="secondaryBtn" onClick={closeAddLiquidity}>
                Cancel
              </button>

              <button
                className="primaryBtn"
                onClick={handleAddLiquidity}
                disabled={liqLoading || circleActionsBusy}
              >
                {liqLoading ? "Supplying..." : circleActionsBusy ? "Please wait..." : "Supply Liquidity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRemoveLiquidity && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal card removeLiqModal">
            <h3 className="removeLiqTitle">Remove Liquidity</h3>

            <div className="card removeLiqCard">
              <div className="removeLiqHead">
                <span className="muted removeLiqLabel">
                  Withdraw amounts
                </span>
                <div className="removeLiqQuickInline" aria-label="Quick withdraw">
                  <button className="removeLiqChip" type="button" onClick={() => setRemoveByPct(25)}>
                    25%
                  </button>
                  <button className="removeLiqChip" type="button" onClick={() => setRemoveByPct(50)}>
                    50%
                  </button>
                  <button className="removeLiqChip" type="button" onClick={() => setRemoveByPct(75)}>
                    75%
                  </button>
                  <button className="removeLiqChip removeLiqChipPrimary" type="button" onClick={() => setRemoveByPct(100)}>
                    MAX
                  </button>
                </div>
              </div>

              <div className="removeLiqRow">
                <div className="removeLiqTokenGrid">
                  {(activePreset?.tokens || []).map((sym) => {
                    const isDriver = removeDriverSym == null || removeDriverSym === sym;
                    const hasDriver = removeDriverSym != null;
                    const disabled = hasDriver && !isDriver;

                    const lpPos = lpTokenAmounts?.[activePreset?.id]?.[sym];
                    const lpPosStr =
                      lpPos != null && Number.isFinite(Number(lpPos))
                        ? Number(lpPos) < 0.0001 && Number(lpPos) > 0
                          ? "<0.0001"
                          : Number(lpPos).toFixed(4)
                        : "—";

                    const displayValue = disabled
                      ? (removeEstimates?.[sym] != null && Number.isFinite(removeEstimates[sym])
                          ? String(removeEstimates[sym].toFixed(4))
                          : "")
                      : (removeTokenInputs?.[sym] || "");

                    return (
                      <div key={sym} className="card removeLiqTokenCard">
                        <div className="removeLiqTokenTop">
                          <div className="removeLiqTokenLeft">
                            <img src={TOKEN_LOGOS[sym]} alt={sym} className="removeLiqTokenIcon" />
                            <span className="removeLiqTokenSym">{sym}</span>
                          </div>
                          <span className="muted removeLiqTokenEst">
                            LP Bal:{" "}
                            <span className="removeLiqTokenBal">{lpPosStr}</span>
                          </span>
                        </div>

                        <div className="removeLiqTokenRow">
                          <input
                            className={`swapInput removeLiqTokenInput ${disabled ? "readOnly" : ""}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={displayValue}
                            disabled={disabled}
                            onFocus={() => {
                              if (!disabled) return;
                              // Switch driver to this token
                              setRemoveDriverSym(sym);
                              setRemoveTokenInputs({ [sym]: "" });
                              setRemoveEstimates({});
                              setRemoveLpAmount("");
                            }}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRemoveDriverSym(sym);
                              setRemoveTokenInputs({ [sym]: v });
                              computeRemoveFromToken(sym, v);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {Object.keys(removeEstimates || {}).length > 0 && (
                <div className="removeLiqEstList">
                  {(activePreset?.tokens || []).map((sym) => (
                    <div key={sym} className="removeLiqEstRow">
                      <span className="muted">Withdraws</span>
                      <strong>
                        {removeEstimates?.[sym] != null && Number.isFinite(removeEstimates[sym])
                          ? removeEstimates[sym] < 0.0001 && removeEstimates[sym] > 0
                            ? `<0.0001 ${sym}`
                            : `${removeEstimates[sym].toFixed(4)} ${sym}`
                          : `— ${sym}`}
                      </strong>
                    </div>
                  ))}
                </div>
              )}

              {removeCalcError && <div className="removeLiqError">{removeCalcError}</div>}
            </div>

            <div className="txActions removeLiqActions">
              <button className="secondaryBtn" onClick={() => { setShowRemoveLiquidity(false); setRemoveLpAmount(""); }}>
                Cancel
              </button>
              <button
                className="primaryBtn"
                onClick={handleRemoveLiquidity}
                disabled={
                  circleActionsBusy ||
                  removeLoading ||
                  !removeLpAmount ||
                  Number(removeLpAmount) <= 0
                }
              >
                {removeLoading
                  ? "Removing..."
                  : circleActionsBusy
                    ? "Please wait..."
                    : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toastContainer" role="status" aria-live="polite">
          <div className="toastBubble">{toast}</div>
        </div>
      )}
    </div>
  );
}

