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

function secureRandomScalarBytes() {
  // Prefer platform CSPRNG directly; fallback to noble helper.
  const webCrypto = globalThis?.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    // Rejection sample to fit secp256k1 scalar range (1..n-1)
    for (let i = 0; i < 64; i += 1) {
      const bytes = new Uint8Array(32);
      webCrypto.getRandomValues(bytes);
      const n = bytesToBigInt(bytes);
      if (n > 0n && n < CURVE_N) return bytes;
    }
  }
  return secpUtils.randomPrivateKey();
}

function normalizePublicKey(pubKeyHex) {
  const raw = ethers.getBytes(pubKeyHex);
  if (raw.length !== 33 && raw.length !== 65) {
    throw new Error("Public key must be 33-byte compressed or 65-byte uncompressed");
  }
  return ethers.hexlify(raw);
}

// noble/secp256k1 v3 Point.fromHex only accepts bare hex strings (no 0x, no Uint8Array)
function toPointHex(input) {
  if (typeof input === "string") return input.replace(/^0x/i, "");
  return ethers.hexlify(input).slice(2);
}

function pubKeyToAddress(pubKeyBytesUncompressed) {
  const full = ethers.getBytes(pubKeyBytesUncompressed);
  const uncompressed =
    full.length === 65 ? full : Point.fromHex(toPointHex(full)).toBytes(false);
  const hash = ethers.keccak256(uncompressed.slice(1));
  return ethers.getAddress(`0x${hash.slice(-40)}`);
}

/**
 * Generate receiver key material (store private keys securely).
 */
export function generateStealthReceiverKeys() {
  const spendPrivateKey = ethers.hexlify(secureRandomScalarBytes());
  const viewPrivateKey = ethers.hexlify(secureRandomScalarBytes());

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
      : secureRandomScalarBytes();
  const ephPrivBigInt = bytesToBigInt(ephPriv);

  // R = rG (ephemeral public key)
  const ephemeralPublicKey = ethers.hexlify(getPublicKey(ephPriv, true));

  // S = r * V (V = receiver view public key)
  const sharedPoint = Point.fromHex(toPointHex(viewPub)).multiply(ephPrivBigInt);
  const sharedScalar = hashToScalar(sharedPoint.toBytes(true));

  // P_stealth = P_spend + H(S)*G
  const stealthPoint = Point.fromHex(toPointHex(spendPub)).add(Point.BASE.multiply(sharedScalar));
  const stealthPublicKeyCompressed = ethers.hexlify(stealthPoint.toBytes(true));
  const stealthPublicKeyUncompressed = ethers.hexlify(stealthPoint.toBytes(false));
  const stealthAddress = pubKeyToAddress(stealthPoint.toBytes(false));

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

  const sharedPoint = Point.fromHex(toPointHex(ephPub)).multiply(viewPriv);
  const sharedScalar = hashToScalar(sharedPoint.toBytes(true));
  const localViewTag = ethers.hexlify(bigIntTo32Bytes(sharedScalar).slice(0, 1));

  if (announcedViewTag && localViewTag.toLowerCase() !== announcedViewTag.toLowerCase()) {
    return { match: false, reason: "view-tag-mismatch" };
  }

  const stealthPoint = Point.fromHex(toPointHex(spendPub)).add(Point.BASE.multiply(sharedScalar));
  const localStealthAddress = pubKeyToAddress(stealthPoint.toBytes(false));
  const match =
    localStealthAddress.toLowerCase() === String(announcedStealthAddress).toLowerCase();

  return {
    match,
    localStealthAddress,
    localViewTag,
    sharedSecretScalar: `0x${sharedScalar.toString(16)}`,
    stealthPublicKeyCompressed: ethers.hexlify(stealthPoint.toBytes(true)),
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

  const sharedPoint = Point.fromHex(toPointHex(ephPub)).multiply(viewPriv);
  const sharedScalar = hashToScalar(sharedPoint.toBytes(true));

  const stealthPriv = (spendPriv + sharedScalar) % CURVE_N;
  if (stealthPriv === 0n) throw new Error("Derived invalid stealth private key");

  const stealthPrivateKey = ethers.hexlify(bigIntTo32Bytes(stealthPriv));
  const stealthPublicKey = ethers.hexlify(getPublicKey(ethers.getBytes(stealthPrivateKey), true));
  const stealthAddress = pubKeyToAddress(Point.fromHex(toPointHex(stealthPublicKey)).toBytes(false));

  return {
    stealthPrivateKey,
    stealthPublicKey,
    stealthAddress,
  };
}

