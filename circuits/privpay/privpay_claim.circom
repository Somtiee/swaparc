// PRIVPAY withdrawal claim — Poseidon Merkle + note opening (circom 2.x).
// Matches JS witness helpers in src/utils/privpayWitness.js (field encoding).
//
// Tree: Poseidon(2) at each level, empty leaf convention off-chain (siblings in path).
// ZKPrivacyPool on-chain uses the same Poseidon leaf + incremental Merkle as this circuit.
//
// Compile (from repo root, circom on PATH):
//   circom circuits/privpay/privpay_claim.circom --r1cs --wasm -o build/privpay \
//     -l node_modules/circomlib/circuits
//
// Public outputs order (must match snarkjs Groth16 publicSignals):
//   root, nullifierHash, amount, recipient, noteCommitment
// noteCommitment must equal Poseidon(secret, nullifier, amount, recipient) so the pool can tie the
// proof to the amount stored at deposit(commitment => amount).

pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";

template PrivPayClaim(levels) {
    signal input root;
    signal input nullifierHash;
    signal input amount;
    signal input recipient;
    signal input noteCommitment;

    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndex[levels];

    component noteLeaf = Poseidon(4);
    noteLeaf.inputs[0] <== secret;
    noteLeaf.inputs[1] <== nullifier;
    noteLeaf.inputs[2] <== amount;
    noteLeaf.inputs[3] <== recipient;

    noteCommitment === noteLeaf.out;

    component nul = Poseidon(2);
    nul.inputs[0] <== secret;
    nul.inputs[1] <== nullifier;
    nul.out === nullifierHash;

    component H[levels];
    signal cur[levels + 1];
    signal oneMinus[levels];
    signal left[levels];
    signal right[levels];
    signal mulLeft0[levels];
    signal mulLeft1[levels];
    signal mulRight0[levels];
    signal mulRight1[levels];
    cur[0] <== noteLeaf.out;

    for (var i = 0; i < levels; i++) {
        pathIndex[i] * (pathIndex[i] - 1) === 0;

        oneMinus[i] <== 1 - pathIndex[i];

        mulLeft0[i] <== cur[i] * oneMinus[i];
        mulLeft1[i] <== pathElements[i] * pathIndex[i];
        left[i] <== mulLeft0[i] + mulLeft1[i];
        mulRight0[i] <== cur[i] * pathIndex[i];
        mulRight1[i] <== pathElements[i] * oneMinus[i];
        right[i] <== mulRight0[i] + mulRight1[i];

        H[i] = Poseidon(2);
        H[i].inputs[0] <== left[i];
        H[i].inputs[1] <== right[i];
        cur[i + 1] <== H[i].out;
    }

    cur[levels] === root;
}

// Default depth 16 — must match PRIVACY_POOL_MERKLE_HEIGHT / deployment.
component main {
    public [root, nullifierHash, amount, recipient, noteCommitment]
} = PrivPayClaim(16);
