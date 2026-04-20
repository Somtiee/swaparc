/**
 * Incremental Poseidon Merkle mirror (BN254 / circomlib-compatible).
 * Matches `ZKPrivacyPool` on-chain tree and `circuits/privpay/privpay_claim.circom`.
 */

import { buildPoseidon } from "circomlibjs";

let _poseidonPromise = null;
async function getPoseidon() {
  if (!_poseidonPromise) _poseidonPromise = buildPoseidon();
  return _poseidonPromise;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
export async function poseidonPairBytes(a, b) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  // Tree nodes are stored as 32-byte little-endian field bytes.
  const xa = F.fromRprLE(a, 0);
  const xb = F.fromRprLE(b, 0);
  const out = poseidon([xa, xb]);
  const bytes = new Uint8Array(32);
  F.toRprLE(bytes, 0, out);
  return bytes;
}

export async function buildPoseidonZeros(height) {
  let cur = new Uint8Array(32);
  const zeros = [];
  for (let i = 0; i < height; i++) {
    zeros.push(cur);
    cur = await poseidonPairBytes(cur, cur);
  }
  return { zeros, emptyRoot: cur };
}

function bytesEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class PrivacyPoolPoseidonMerkleMirror {
  constructor(height, zeros, emptyRoot) {
    if (height < 16 || height > 32) throw new Error("height must be 16..32");
    this.height = height;
    this.zeros = zeros;
    this.emptyRoot = emptyRoot;
    this.filledSubtrees = [...zeros];
    this.nextIndex = 0;
    this.currentRoot = emptyRoot;
    /** @type {Map<string, Uint8Array>} */
    this.mem = new Map();
    this.rootHistory = [emptyRoot];
    this.leafCommitments = [];
  }

  static async create(height) {
    const { zeros, emptyRoot } = await buildPoseidonZeros(height);
    return new PrivacyPoolPoseidonMerkleMirror(height, zeros, emptyRoot);
  }

  _k(depth, pos) {
    return `${depth}:${pos}`;
  }

  /** @param {Uint8Array} leafBytes 32-byte Poseidon note output */
  async insert(leafBytes) {
    const idx = this.nextIndex;
    if (idx >= 2 ** this.height) throw new Error("Tree full");

    const height = this.height;
    const zeros = this.zeros;
    const filledSubtrees = this.filledSubtrees;

    let hash = leafBytes;
    let cur = idx;
    this.mem.set(this._k(0, idx), leafBytes);
    this.leafCommitments[idx] = leafBytes;

    for (let i = 0; i < height; i++) {
      if ((cur & 1) === 0) {
        filledSubtrees[i] = hash;
        this.mem.set(this._k(i, cur), hash);
        hash = await poseidonPairBytes(hash, zeros[i]);
        this.mem.set(this._k(i + 1, cur >> 1), hash);
      } else {
        const left = filledSubtrees[i];
        hash = await poseidonPairBytes(left, hash);
        this.mem.set(this._k(i + 1, cur >> 1), hash);
      }
      cur >>= 1;
    }

    this.currentRoot = hash;
    this.nextIndex = idx + 1;
    this.rootHistory.push(hash);
    return { leafIndex: idx, root: hash };
  }

  async getMerkleProof(leafIndex, depositCount = null) {
    const n = depositCount ?? this.nextIndex;
    if (leafIndex >= n) throw new Error("leafIndex out of range for depositCount");
    const leaves = this.leafCommitments.slice(0, n);
    if (leaves[leafIndex] == null) throw new Error("missing leaf at index");
    const m = await PrivacyPoolPoseidonMerkleMirror.replayThrough(leaves, this.height, this.zeros, this.emptyRoot);
    return m._proofFromMem(leafIndex, n);
  }

  async _proofFromMem(leafIndex, nDeposits) {
    const pathElements = [];
    const pathIsRight = [];
    let idx = leafIndex;
    for (let i = 0; i < this.height; i++) {
      const isRightNode = (idx & 1) === 1;
      const siblingIdx = idx ^ 1;
      const sibKey = this._k(i, siblingIdx);
      const siblingHash = this.mem.get(sibKey) ?? this.zeros[i];
      pathElements.push(siblingHash);
      pathIsRight.push(isRightNode);
      idx >>= 1;
    }
    const leaf = this.leafCommitments[leafIndex];
    let h = leaf;
    for (let i = 0; i < this.height; i++) {
      if (pathIsRight[i]) h = await poseidonPairBytes(pathElements[i], h);
      else h = await poseidonPairBytes(h, pathElements[i]);
    }
    const want = this.rootHistory[nDeposits];
    if (!bytesEq(h, want)) {
      throw new Error(`Proof/root mismatch (Poseidon local). leafIndex=${leafIndex} n=${nDeposits}`);
    }
    return {
      leaf,
      leafIndex,
      root: this.rootHistory[nDeposits],
      pathElements,
      pathIsRight,
      depositCount: nDeposits,
    };
  }

  static async replayThrough(leaves, height, zerosCopy, emptyRoot) {
    const m = new PrivacyPoolPoseidonMerkleMirror(height, [...zerosCopy], emptyRoot);
    m.filledSubtrees = [...zerosCopy];
    m.nextIndex = 0;
    m.currentRoot = emptyRoot;
    m.mem.clear();
    m.rootHistory = [emptyRoot];
    m.leafCommitments = [];
    for (let i = 0; i < leaves.length; i++) {
      await m.insert(leaves[i]);
    }
    return m;
  }
}

export async function verifyPoseidonMerkleProofLocal(leaf, root, pathElements, pathIsRight, height) {
  if (pathElements.length !== height || pathIsRight.length !== height) return false;
  let h = leaf;
  for (let i = 0; i < height; i++) {
    if (pathIsRight[i]) h = await poseidonPairBytes(pathElements[i], h);
    else h = await poseidonPairBytes(h, pathElements[i]);
  }
  return bytesEq(h, root);
}

async function selfTest() {
  const height = 16;
  const tree = await PrivacyPoolPoseidonMerkleMirror.create(height);
  const leaves = [];
  for (let i = 0; i < 5; i++) {
    const leaf = new Uint8Array(32);
    crypto.getRandomValues(leaf);
    leaves.push(leaf);
    await tree.insert(leaf);
  }
  for (let li = 0; li < 5; li++) {
    for (let n = li + 1; n <= 5; n++) {
      const m = await PrivacyPoolPoseidonMerkleMirror.replayThrough(leaves.slice(0, n), height, tree.zeros, tree.emptyRoot);
      const proof = await m._proofFromMem(li, n);
      const ok = await verifyPoseidonMerkleProofLocal(proof.leaf, proof.root, proof.pathElements, proof.pathIsRight, height);
      if (!ok) {
        console.error("FAIL", { li, n });
        process.exit(1);
      }
    }
  }
  console.log("privacyPoolPoseidonMerkle.mjs self-test OK (height=%s)", height);
}

// Browser bundlers polyfill `process` but not `argv`; avoid touching `argv` unless present (Node CLI only).
if (
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.includes("privacyPoolPoseidonMerkle.mjs")
) {
  selfTest();
}
