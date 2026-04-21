/**

 * Build Groth16 witness + proof for ZKPrivacyPool / full packed verifier.

 */



import { ethers } from "ethers";

import { PrivacyPoolPoseidonMerkleMirror } from "../../scripts/privacyPoolPoseidonMerkle.mjs";

import { fetchZkPoolLeavesFromRpc, findLeafIndex } from "./privpayMerkleFromLogs.js";

import { buildPrivpayCircuitInput, PRIVPAY_CIRCUIT_LEVELS } from "./privpayWitness.js";

import { generatePrivpayPoolProof } from "./privpayProof.js";

import { decryptNoteSecrets } from "./privpayNoteStorage.js";



function requireWasmZkey(wasmUrl, zkeyUrl) {

  if (!wasmUrl || !zkeyUrl) {

    throw new Error(

      "Set VITE_PRIVPAY_WASM_URL and VITE_PRIVPAY_ZKEY_URL (e.g. /circuits/privpay/privpay_claim.wasm)."

    );

  }

}



async function proveWithSecretsCore({

  provider,

  poolAddress,

  recipient,

  amountWei,

  commitment,

  merkleHeight,

  secretHex,

  nullifierHex,

  wasmUrl,

  zkeyUrl,

  savedRootHex,

  fromBlockOverride,

  precomputedProofContext,

}) {

  requireWasmZkey(wasmUrl, zkeyUrl);

  const height = Number(merkleHeight) || PRIVPAY_CIRCUIT_LEVELS;



  let root;
  let pathElements;
  let pathIsRight;
  let idx = -1;

  if (precomputedProofContext) {
    root = ethers.getBytes(ethers.zeroPadValue(precomputedProofContext.root, 32));
    pathElements = (precomputedProofContext.pathElements || []).map((p) =>
      ethers.getBytes(ethers.zeroPadValue(p, 32))
    );
    pathIsRight = (precomputedProofContext.pathIsRight || []).map((b) => Boolean(b));
    idx = Number(precomputedProofContext.leafIndex ?? -1);
    if (!Number.isFinite(idx) || idx < 0) {
      throw new Error("Invalid precomputed claim context: missing leafIndex.");
    }
    if (pathElements.length !== height || pathIsRight.length !== height) {
      throw new Error("Invalid precomputed claim context: malformed Merkle path.");
    }
  } else {
    const latestBlock = await provider.getBlockNumber();
    const leaves = await fetchZkPoolLeavesFromRpc(
      provider,
      poolAddress,
      latestBlock,
      fromBlockOverride
    );

    const commitmentBytes = ethers.getBytes(ethers.zeroPadValue(commitment, 32));

    idx = findLeafIndex(leaves, commitmentBytes);

    if (idx < 0) {
      // ARC log scans are chunked in 9,999-block windows with a soft cap of 400 chunks.
      // If the configured deploy block is too recent, retry with the widest safe history
      // window before giving up so older deposits can still be claimed.
      const fallbackWindowBlocks = 9999 * 400;
      const fallbackFrom = Math.max(0, Number(latestBlock) - fallbackWindowBlocks);
      const leavesRetry = await fetchZkPoolLeavesFromRpc(
        provider,
        poolAddress,
        latestBlock,
        fallbackFrom
      );
      const idxRetry = findLeafIndex(leavesRetry, commitmentBytes);
      if (idxRetry < 0) {
        throw new Error(
          "Commitment not found in pool deposit history. Check that the claim code matches the correct pool and ARC network, and lower VITE_PRIVACY_POOL_FROM_BLOCK if this deposit is older than your current scan window."
        );
      }
      const mirrorRetry = await PrivacyPoolPoseidonMerkleMirror.create(height);
      for (const lb of leavesRetry) {
        await mirrorRetry.insert(lb);
      }
      const p = await mirrorRetry.getMerkleProof(idxRetry, idxRetry + 1);
      root = p.root;
      pathElements = p.pathElements;
      pathIsRight = p.pathIsRight;
      idx = idxRetry;
    } else {
      const mirror = await PrivacyPoolPoseidonMerkleMirror.create(height);
      for (const lb of leaves) {
        await mirror.insert(lb);
      }
      const p = await mirror.getMerkleProof(idx, idx + 1);
      root = p.root;
      pathElements = p.pathElements;
      pathIsRight = p.pathIsRight;
    }
  }



  if (savedRootHex && ethers.hexlify(root) !== ethers.hexlify(savedRootHex)) {

    console.warn(

      "[privpay] Live Merkle root differs from saved deposit root — more deposits occurred; using chain state."

    );

  }



  const input = await buildPrivpayCircuitInput({

    secretHex,

    nullifierHex,

    amountWei,

    recipientAddress: recipient,

    rootBytes: root,

    path: { pathElements, pathIsRight },

  });



  const proofOut = await generatePrivpayPoolProof(input, wasmUrl, zkeyUrl);

  return { ...proofOut, input, leafIndex: idx };

}



/**

 * @param {object} p

 * @param {ethers.Provider} p.provider

 * @param {object} p.note saved note from privpayNoteStorage

 * @param {string} [p.passphrase]

 * @param {string} p.wasmUrl

 * @param {string} p.zkeyUrl

 */

export async function proveZkPoolWithdraw({ provider, note, passphrase, wasmUrl, zkeyUrl }) {

  const height = Number(note.merkleHeight) || PRIVPAY_CIRCUIT_LEVELS;

  const { secretHex, nullifierHex } = await decryptNoteSecrets(note.enc, passphrase);



  return proveWithSecretsCore({

    provider,

    poolAddress: note.poolAddress,

    recipient: note.recipient,

    amountWei: note.amountWei,

    commitment: note.commitment,

    merkleHeight: height,

    secretHex,

    nullifierHex,

    wasmUrl,

    zkeyUrl,

    savedRootHex: note.root || null,

  });

}



/**

 * Claim-code path: v3 `zk-claim` payloads embed secrets; same on-chain withdraw as saved notes.

 */

export async function proveZkPoolWithdrawWithSecrets({

  provider,

  poolAddress,

  recipient,

  amountWei,

  commitment,

  merkleHeight,

  secretHex,

  nullifierHex,

  wasmUrl,

  zkeyUrl,

  fromBlockOverride,

  precomputedProofContext,

}) {

  return proveWithSecretsCore({

    provider,

    poolAddress,

    recipient,

    amountWei,

    commitment,

    merkleHeight,

    secretHex,

    nullifierHex,

    wasmUrl,

    zkeyUrl,

    fromBlockOverride,

    precomputedProofContext,

    savedRootHex: null,

  });

}


