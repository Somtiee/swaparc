/**
 * Groth16 proof generation (snarkjs) for PRIVPAY `privpay_claim.circom`.
 *
 * Browser: copy `build/privpay/privpay_claim.wasm` and `privpay_claim_final.zkey` to `public/circuits/privpay/`
 * and pass URLs to `generatePrivpayPoolProof`.
 *
 * Public signals order: [root, nullifierHash, amount, recipient, noteCommitment] — must match on-chain verifier.
 */

import { ethers } from "ethers";

// Session-level artifact cache: the wasm (2.4MB) + zkey (4.5MB) used to be
// re-downloaded on EVERY prove attempt (cache-busted with Date.now()), which
// multiplied load time across claim retries and read as a hang.
const artifactCache = new Map();

/**
 * Fetch proving artifact as bytes in browser; cached in memory for the
 * session so claim retries don't re-download ~7MB each time.
 * Pass through Uint8Array and node-local paths unchanged.
 * @param {string | Uint8Array} src
 * @returns {Promise<string | Uint8Array>}
 */
async function resolveProvingArtifact(src) {
  if (!(typeof src === "string")) return src;
  // Node/local filesystem paths should be passed directly to snarkjs.
  if (!src.startsWith("/") && !/^https?:\/\//i.test(src)) return src;
  const cached = artifactCache.get(src);
  if (cached) return cached;
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Failed to load proving artifact: ${src} (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  artifactCache.set(src, bytes);
  return bytes;
}

/** Same directory as zkey — used to load verification_key.json for a post-prove sanity check. */
async function loadPrivpayVerificationKey(zkeyPathStr) {
  if (typeof zkeyPathStr !== "string" || !zkeyPathStr) return null;

  if (zkeyPathStr.startsWith("/") || /^https?:\/\//i.test(zkeyPathStr)) {
    const base = zkeyPathStr.split("?")[0];
    const vkUrl = base.replace(/[^/]+$/, "verification_key.json");
    try {
      const res = await fetch(vkUrl);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  if (globalThis.window === undefined) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const p = path.join(path.dirname(zkeyPathStr), "verification_key.json");
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {object} proof snarkjs groth16 fullProve result
 * @returns {string} partial ABI-encoded Groth16 points (pA, pB, pC) only — full withdraw uses `encodeFullZkWithdrawProof`
 */
export function encodeGroth16ProofBytes(proof) {
  const toBn = (x) => BigInt(x);
  const pA = [toBn(proof.pi_a[0]), toBn(proof.pi_a[1])];
  const pB = [
    [toBn(proof.pi_b[0][1]), toBn(proof.pi_b[0][0])],
    [toBn(proof.pi_b[1][1]), toBn(proof.pi_b[1][0])],
  ];
  const pC = [toBn(proof.pi_c[0]), toBn(proof.pi_c[1])];
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [pA, pB, pC]
  );
}

/**
 * Full calldata for `PrivPayGroth16Verifier` / packed `withdraw` proof blob:
 * abi.encode(pA, pB, pC, pubSignals[5]).
 */
export function encodeFullZkWithdrawProof(proof, publicSignals) {
  const toBn = (x) => BigInt(x);
  const pA = [toBn(proof.pi_a[0]), toBn(proof.pi_a[1])];
  const pB = [
    [toBn(proof.pi_b[0][1]), toBn(proof.pi_b[0][0])],
    [toBn(proof.pi_b[1][1]), toBn(proof.pi_b[1][0])],
  ];
  const pC = [toBn(proof.pi_c[0]), toBn(proof.pi_c[1])];
  const pub = publicSignals.map((s) => toBn(s));
  if (pub.length !== 5) throw new Error("Expected 5 public signals");
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[5]"],
    [pA, pB, pC, pub]
  );
}

/**
 * @param {Record<string, string>} input from buildPrivpayCircuitInput
 * @param {string | Uint8Array} wasmPath path/URL to .wasm
 * @param {string | Uint8Array} zkeyPath path/URL to .zkey
 * @returns {Promise<{ proof: object, publicSignals: string[], proofBytes: string, callDataRaw: string }>}
 */
export async function generatePrivpayPoolProof(input, wasmPath, zkeyPath) {
  const { groth16 } = await import("snarkjs");
  const wasmSrc = await resolveProvingArtifact(wasmPath);
  const zkeySrc = await resolveProvingArtifact(zkeyPath);
  const { proof, publicSignals } = await groth16.fullProve(input, wasmSrc, zkeySrc);
  const vkey = await loadPrivpayVerificationKey(zkeyPath);
  if (vkey) {
    const ok = await groth16.verify(vkey, publicSignals, proof);
    if (!ok) {
      throw new Error(
        "Groth16 local verify failed (proof vs verification_key.json). Regenerate zk artifacts or check wasm/zkey/vk set."
      );
    }
  }
  const proofBytes = encodeGroth16ProofBytes(proof);
  const fullProofBytes = encodeFullZkWithdrawProof(proof, publicSignals);
  const callDataRaw = await groth16.exportSolidityCallData(proof, publicSignals);
  return { proof, publicSignals, proofBytes, fullProofBytes, callDataRaw };
}

/**
 * Maps publicSignals to Solidity-typed values incl. noteCommitment (Poseidon leaf field element as bytes32).
 * @param {string[]} publicSignals
 */
export function parsePrivpayPublicSignals(publicSignals) {
  const [rootBn, nullifierBn, amountBn, recipientBn, noteCb] = publicSignals.map((s) => BigInt(s));
  const root = ethers.zeroPadValue(ethers.toBeHex(rootBn), 32);
  const nullifierHash = ethers.zeroPadValue(ethers.toBeHex(nullifierBn), 32);
  const amount = amountBn;
  const recipient = ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(recipientBn), 20));
  const noteCommitment = ethers.zeroPadValue(ethers.toBeHex(noteCb), 32);
  return { root, nullifierHash, amount, recipient, noteCommitment };
}
