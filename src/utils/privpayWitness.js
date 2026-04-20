/**
 * Build `input` JSON for `circuits/privpay/privpay_claim.circom` (snarkjs fullProve).
 * Field values are decimal strings (BN128 scalar), matching Circom witness.
 *
 * @typedef {object} PrivpayPathInput
 * @property {readonly Uint8Array[]} pathElements - 32-byte siblings bottom-up (length = levels)
 * @property {readonly boolean[]} pathIsRight - sibling on the right at each level (standard Merkle path bit order)
 */

import { buildPoseidon } from "circomlibjs";
import { ethers } from "ethers";

/** Must match `component main = PrivPayClaim(N)` in privpay_claim.circom */
export const PRIVPAY_CIRCUIT_LEVELS = 16;

let _poseidon = null;
async function poseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

function hex32ToBeBuffer(hex) {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  const b = ethers.getBytes(ethers.zeroPadValue(h, 32));
  return b;
}

export function addressToRecipientField(address) {
  const a = ethers.getAddress(address);
  const bytes = ethers.getBytes(a);
  let v = 0n;
  for (let i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

/** @param {Uint8Array} b */
export function bytes32ToFieldString(b, F) {
  return F.toString(F.fromRprLE(b, 0));
}

/**
 * Poseidon(4)(secret, nullifier, amount, recipient) as 32-byte LE result (circomlibjs).
 */
export async function computePrivpayNoteLeafBytes(secretHex, nullifierHex, amountWei, recipientAddress) {
  const p = await poseidon();
  const F = p.F;
  const s = F.e(BigInt(ethers.toBigInt(secretHex)));
  const n = F.e(BigInt(ethers.toBigInt(nullifierHex)));
  const a = F.e(BigInt(amountWei));
  const r = F.e(addressToRecipientField(recipientAddress));
  const out = p([s, n, a, r]);
  const bytes = new Uint8Array(32);
  F.toRprLE(bytes, 0, out);
  return bytes;
}

export async function computePrivpayNullifierHashBytes(secretHex, nullifierHex) {
  const p = await poseidon();
  const F = p.F;
  const s = F.e(BigInt(ethers.toBigInt(secretHex)));
  const n = F.e(BigInt(ethers.toBigInt(nullifierHex)));
  const out = p([s, n]);
  const bytes = new Uint8Array(32);
  F.toRprLE(bytes, 0, out);
  return bytes;
}

/**
 * Full witness public + private map for snarkjs.
 *
 * @param {object} p
 * @param {string} p.secretHex bytes32
 * @param {string} p.nullifierHex bytes32
 * @param {bigint|string} p.amountWei
 * @param {string} p.recipientAddress checksummed 0x address
 * @param {Uint8Array} p.rootBytes 32-byte root (LE Poseidon tree)
 * @param {PrivpayPathInput} p.path
 */
export async function buildPrivpayCircuitInput({
  secretHex,
  nullifierHex,
  amountWei,
  recipientAddress,
  rootBytes,
  path,
}) {
  const levels = PRIVPAY_CIRCUIT_LEVELS;
  if (path.pathElements.length !== levels || path.pathIsRight.length !== levels) {
    throw new Error(`path length must be ${levels} (PRIVPAY_CIRCUIT_LEVELS)`);
  }

  const p = await poseidon();
  const F = p.F;

  const secret = F.toString(F.e(BigInt(ethers.toBigInt(secretHex))));
  const nullifier = F.toString(F.e(BigInt(ethers.toBigInt(nullifierHex))));
  const amount = F.toString(F.e(BigInt(amountWei)));
  const recipient = F.toString(F.e(addressToRecipientField(recipientAddress)));

  const nullifierHashBytes = await computePrivpayNullifierHashBytes(secretHex, nullifierHex);
  const nullifierHash = bytes32ToFieldString(nullifierHashBytes, F);

  const noteLeafBytes = await computePrivpayNoteLeafBytes(secretHex, nullifierHex, amountWei, recipientAddress);
  const noteCommitment = bytes32ToFieldString(noteLeafBytes, F);

  const root = bytes32ToFieldString(rootBytes, F);

  const pathElements = path.pathElements.map((pe) => bytes32ToFieldString(pe, F));
  const pathIndex = path.pathIsRight.map((b) => (b ? "1" : "0"));

  return {
    root,
    nullifierHash,
    amount,
    recipient,
    noteCommitment,
    secret,
    nullifier,
    pathElements,
    pathIndex,
  };
}

/**
 * Hex-encoded roots / siblings for apps that store bytes32.
 */
export async function buildPrivpayCircuitInputFromHex({
  secretHex,
  nullifierHex,
  amountWei,
  recipientAddress,
  rootHex,
  pathElementsHex,
  pathIsRight,
}) {
  const rootBytes = hex32ToBeBuffer(rootHex);
  const pathElements = pathElementsHex.map((h) => hex32ToBeBuffer(h));
  return buildPrivpayCircuitInput({
    secretHex,
    nullifierHex,
    amountWei,
    recipientAddress,
    rootBytes,
    path: { pathElements, pathIsRight },
  });
}
