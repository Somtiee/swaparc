import { ethers } from "ethers";
import { Point, getPublicKey, utils as secpUtils } from "@noble/secp256k1";

// secp256k1 curve order
const CURVE_N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);

function bytesToBigInt(bytes) {
  const hex = ethers.hexlify(bytes).slice(2);
  return BigInt(`0x${hex}`);
}

function bigIntTo32Bytes(n) {
  const hex = n.toString(16).padStart(64, "0");
  return ethers.getBytes(`0x${hex}`);
}

function hashToScalar(inputBytes) {
  // Keccak-based scalar derivation used by many EVM stealth schemes.
  const digest = ethers.getBytes(ethers.keccak256(inputBytes));
  const scalar = bytesToBigInt(digest) % CURVE_N;
  if (scalar === 0n) return 1n;
  return scalar;
}

function normalizePublicKey(pubKeyHex) {
  const raw = ethers.getBytes(pubKeyHex);
  if (raw.length !== 33 && raw.length !== 65) {
    throw new Error("Public key must be 33-byte compressed or 65-byte uncompressed");
  }
  return ethers.hexlify(raw);
}

function pubKeyToAddress(pubKeyBytesUncompressed) {
  const full = ethers.getBytes(pubKeyBytesUncompressed);
  const uncompressed =
    full.length === 65 ? full : Point.fromHex(full).toRawBytes(false);
  const hash = ethers.keccak256(uncompressed.slice(1));
  return ethers.getAddress(`0x${hash.slice(-40)}`);
}

/**
 * Generate receiver key material (store private keys securely).
 */
export function generateStealthReceiverKeys() {
  const spendPrivateKey = ethers.hexlify(secpUtils.randomPrivateKey());
  const viewPrivateKey = ethers.hexlify(secpUtils.randomPrivateKey());

  const spendPublicKey = ethers.hexlify(getPublicKey(ethers.getBytes(spendPrivateKey), true));
  const viewPublicKey = ethers.hexlify(getPublicKey(ethers.getBytes(viewPrivateKey), true));

  return {
    spendPrivateKey,
    viewPrivateKey,
    spendPublicKey,
    viewPublicKey,
  };
}

/**
 * Sender path:
 * 1) generate ephemeral key
 * 2) ECDH with receiver view public key
 * 3) derive stealth pub/address from receiver spend public key
 */
export function deriveStealthPayment({
  receiverSpendPublicKey,
  receiverViewPublicKey,
  ephemeralPrivateKey,
}) {
  const spendPub = normalizePublicKey(receiverSpendPublicKey);
  const viewPub = normalizePublicKey(receiverViewPublicKey);

  const ephPriv =
    ephemeralPrivateKey != null
      ? ethers.getBytes(ephemeralPrivateKey)
      : secpUtils.randomPrivateKey();
  const ephPrivBigInt = bytesToBigInt(ephPriv);

  // R = rG (ephemeral public key)
  const ephemeralPublicKey = ethers.hexlify(getPublicKey(ephPriv, true));

  // S = r * V (V = receiver view public key)
  const sharedPoint = Point.fromHex(viewPub).multiply(ephPrivBigInt);
  const sharedScalar = hashToScalar(sharedPoint.toRawBytes(true));

  // P_stealth = P_spend + H(S)*G
  const stealthPoint = Point.fromHex(spendPub).add(Point.BASE.multiply(sharedScalar));
  const stealthPublicKeyCompressed = ethers.hexlify(stealthPoint.toRawBytes(true));
  const stealthPublicKeyUncompressed = ethers.hexlify(stealthPoint.toRawBytes(false));
  const stealthAddress = pubKeyToAddress(stealthPoint.toRawBytes(false));

  // Optional 1-byte hint to accelerate scanning
  const viewTag = ethers.hexlify(bigIntTo32Bytes(sharedScalar).slice(0, 1));

  return {
    ephemeralPrivateKey: ethers.hexlify(ephPriv),
    ephemeralPublicKey,
    sharedSecretScalar: `0x${sharedScalar.toString(16)}`,
    viewTag,
    stealthPublicKeyCompressed,
    stealthPublicKeyUncompressed,
    stealthAddress,
  };
}

/**
 * Receiver path:
 * 1) ECDH with ephemeral public key and receiver view private key
 * 2) derive expected stealth address
 * 3) check match
 */
export function scanStealthAnnouncement({
  receiverSpendPublicKey,
  receiverViewPrivateKey,
  ephemeralPublicKey,
  announcedStealthAddress,
  announcedViewTag,
}) {
  const spendPub = normalizePublicKey(receiverSpendPublicKey);
  const ephPub = normalizePublicKey(ephemeralPublicKey);
  const viewPriv = bytesToBigInt(ethers.getBytes(receiverViewPrivateKey));

  const sharedPoint = Point.fromHex(ephPub).multiply(viewPriv);
  const sharedScalar = hashToScalar(sharedPoint.toRawBytes(true));
  const localViewTag = ethers.hexlify(bigIntTo32Bytes(sharedScalar).slice(0, 1));

  if (announcedViewTag && localViewTag.toLowerCase() !== announcedViewTag.toLowerCase()) {
    return { match: false, reason: "view-tag-mismatch" };
  }

  const stealthPoint = Point.fromHex(spendPub).add(Point.BASE.multiply(sharedScalar));
  const localStealthAddress = pubKeyToAddress(stealthPoint.toRawBytes(false));
  const match =
    localStealthAddress.toLowerCase() === String(announcedStealthAddress).toLowerCase();

  return {
    match,
    localStealthAddress,
    localViewTag,
    sharedSecretScalar: `0x${sharedScalar.toString(16)}`,
    stealthPublicKeyCompressed: ethers.hexlify(stealthPoint.toRawBytes(true)),
  };
}

/**
 * Receiver derives one-time private key to spend funds at stealth address:
 * x_stealth = x_spend + H(v * R) mod n
 */
export function deriveStealthPrivateKey({
  receiverSpendPrivateKey,
  receiverViewPrivateKey,
  ephemeralPublicKey,
}) {
  const spendPriv = bytesToBigInt(ethers.getBytes(receiverSpendPrivateKey));
  const viewPriv = bytesToBigInt(ethers.getBytes(receiverViewPrivateKey));
  const ephPub = normalizePublicKey(ephemeralPublicKey);

  const sharedPoint = Point.fromHex(ephPub).multiply(viewPriv);
  const sharedScalar = hashToScalar(sharedPoint.toRawBytes(true));

  const stealthPriv = (spendPriv + sharedScalar) % CURVE_N;
  if (stealthPriv === 0n) throw new Error("Derived invalid stealth private key");

  const stealthPrivateKey = ethers.hexlify(bigIntTo32Bytes(stealthPriv));
  const stealthPublicKey = ethers.hexlify(getPublicKey(ethers.getBytes(stealthPrivateKey), true));
  const stealthAddress = pubKeyToAddress(Point.fromHex(stealthPublicKey).toRawBytes(false));

  return {
    stealthPrivateKey,
    stealthPublicKey,
    stealthAddress,
  };
}

