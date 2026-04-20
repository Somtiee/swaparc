import { ethers } from "ethers";

export const PRIVPAY_RELAY_EIP712_NAME = "PrivPayPoolRelay";
export const PRIVPAY_RELAY_EIP712_VERSION = "1";

/** @param {number} [chainIdDec] */
export function privpayRelayChainId(chainIdDec) {
  if (chainIdDec != null && Number.isFinite(chainIdDec)) return Number(chainIdDec);
  const fromEnv = Number(import.meta.env.VITE_ARC_CHAIN_ID || "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 5042002;
}

export function buildPrivpayRelayDomain(poolAddress, chainIdDec) {
  return {
    name: PRIVPAY_RELAY_EIP712_NAME,
    version: PRIVPAY_RELAY_EIP712_VERSION,
    chainId: privpayRelayChainId(chainIdDec),
    verifyingContract: ethers.getAddress(poolAddress),
  };
}

const TYPES_WITHDRAW = {
  RelayWithdraw: [
    { name: "pool", type: "address" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const TYPES_DEPOSIT = {
  RelayDeposit: [
    { name: "pool", type: "address" },
    { name: "depositor", type: "address" },
    { name: "commitment", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

function relayDeadlineSeconds() {
  return Math.floor(Date.now() / 1000) + 540;
}

/**
 * @param {import("ethers").Signer} signer
 * @param {object} p
 */
export async function signPrivpayRelayWithdraw(signer, p) {
  const {
    poolAddress,
    nullifierHash,
    recipient,
    amountWei,
    chainIdDec,
    deadlineSec = relayDeadlineSeconds(),
  } = p;
  const pool = ethers.getAddress(poolAddress);
  const domain = buildPrivpayRelayDomain(pool, chainIdDec);
  const value = {
    pool,
    nullifierHash: ethers.zeroPadValue(ethers.toBeHex(nullifierHash), 32),
    recipient: ethers.getAddress(recipient),
    amount: amountWei,
    deadline: deadlineSec,
  };
  const signature = await signer.signTypedData(domain, TYPES_WITHDRAW, value);
  return { signature, deadline: deadlineSec, domain, value };
}

/**
 * @param {import("ethers").Signer} signer
 * @param {object} p
 */
export async function signPrivpayRelayDeposit(signer, p) {
  const {
    poolAddress,
    depositor,
    commitment,
    amountWei,
    chainIdDec,
    deadlineSec = relayDeadlineSeconds(),
  } = p;
  const pool = ethers.getAddress(poolAddress);
  const from = ethers.getAddress(depositor);
  const domain = buildPrivpayRelayDomain(pool, chainIdDec);
  const value = {
    pool,
    depositor: from,
    commitment: ethers.zeroPadValue(ethers.toBeHex(commitment), 32),
    amount: amountWei,
    deadline: deadlineSec,
  };
  const signature = await signer.signTypedData(domain, TYPES_DEPOSIT, value);
  return { signature, deadline: deadlineSec, domain, value };
}
