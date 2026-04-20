// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PrivPayGroth16Verifier
 * @notice BN254 Groth16 verifier for public signals:
 *         [root, nullifierHash, amount, recipient, noteCommitment].
 *
 * Proof payload:
 *   abi.encode(
 *     uint256[2] pA,
 *     uint256[2][2] pB,
 *     uint256[2] pC,
 *     uint256[5] pubSignals
 *   )
 */
contract PrivPayGroth16Verifier {
    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant BN254_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    struct G1Point {
        uint256 x;
        uint256 y;
    }

    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }

    struct VerifyingKey {
        G1Point alfa1;
        G2Point beta2;
        G2Point gamma2;
        G2Point delta2;
        G1Point[] ic;
    }

    VerifyingKey internal vk;

    error InvalidProofEncoding();
    error InvalidPublicSignal();
    error InvalidVerifyingKey();

    constructor(
        uint256[2] memory alfa1,
        uint256[2][2] memory beta2,
        uint256[2][2] memory gamma2,
        uint256[2][2] memory delta2,
        uint256[2][] memory ic
    ) {
        if (ic.length != 6) revert InvalidVerifyingKey(); // 5 public + constant
        vk.alfa1 = G1Point(alfa1[0], alfa1[1]);
        vk.beta2 = G2Point([beta2[0][0], beta2[0][1]], [beta2[1][0], beta2[1][1]]);
        vk.gamma2 = G2Point([gamma2[0][0], gamma2[0][1]], [gamma2[1][0], gamma2[1][1]]);
        vk.delta2 = G2Point([delta2[0][0], delta2[0][1]], [delta2[1][0], delta2[1][1]]);
        for (uint256 i = 0; i < ic.length; i++) {
            vk.ic.push(G1Point(ic[i][0], ic[i][1]));
        }
    }

    function decodePublicInputs(
        bytes calldata proof
    )
        external
        pure
        returns (bytes32 root, bytes32 nullifierHash, uint256 amount, address recipient, bytes32 noteCommitment)
    {
        (, , , uint256[5] memory pubSignals) = _decodeProof(proof);
        root = bytes32(pubSignals[0]);
        nullifierHash = bytes32(pubSignals[1]);
        amount = pubSignals[2];
        recipient = address(uint160(uint256(pubSignals[3])));
        noteCommitment = bytes32(pubSignals[4]);
    }

    function verifyProof(bytes calldata proof)
        external
        view
        returns (
            bool ok,
            bytes32 root,
            bytes32 nullifierHash,
            uint256 amount,
            address recipient,
            bytes32 noteCommitment
        )
    {
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC, uint256[5] memory pubSignals) =
            _decodeProof(proof);

        root = bytes32(pubSignals[0]);
        nullifierHash = bytes32(pubSignals[1]);
        amount = pubSignals[2];
        recipient = address(uint160(uint256(pubSignals[3])));
        noteCommitment = bytes32(pubSignals[4]);

        ok = _verify(pA, pB, pC, pubSignals);
    }

    function _decodeProof(bytes calldata proof)
        internal
        pure
        returns (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC,
            uint256[5] memory pubSignals
        )
    {
        if (proof.length != 32 * 13) revert InvalidProofEncoding();
        (pA, pB, pC, pubSignals) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2], uint256[5]));
    }

    function _verify(
        uint256[2] memory pA,
        uint256[2][2] memory pB,
        uint256[2] memory pC,
        uint256[5] memory pubSignals
    ) internal view returns (bool) {
        for (uint256 i = 0; i < 5; i++) {
            if (pubSignals[i] >= SNARK_SCALAR_FIELD) revert InvalidPublicSignal();
        }

        G1Point memory vkx = vk.ic[0];
        for (uint256 i = 0; i < 5; i++) {
            vkx = _g1Add(vkx, _g1Mul(vk.ic[i + 1], pubSignals[i]));
        }

        G1Point memory negA = _g1Negate(G1Point(pA[0], pA[1]));

        uint256[24] memory input = [
            negA.x,
            negA.y,
            pB[0][0],
            pB[0][1],
            pB[1][0],
            pB[1][1],
            vk.alfa1.x,
            vk.alfa1.y,
            vk.beta2.x[0],
            vk.beta2.x[1],
            vk.beta2.y[0],
            vk.beta2.y[1],
            vkx.x,
            vkx.y,
            vk.gamma2.x[0],
            vk.gamma2.x[1],
            vk.gamma2.y[0],
            vk.gamma2.y[1],
            pC[0],
            pC[1],
            vk.delta2.x[0],
            vk.delta2.x[1],
            vk.delta2.y[0],
            vk.delta2.y[1]
        ];

        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 8, input, 0x300, out, 0x20)
        }
        return success && out[0] == 1;
    }

    function _g1Negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.x == 0 && p.y == 0) return G1Point(0, 0);
        return G1Point(p.x, BN254_Q - (p.y % BN254_Q));
    }

    function _g1Add(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        uint256[4] memory input = [p1.x, p1.y, p2.x, p2.y];
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 6, input, 0x80, r, 0x40)
        }
        require(success, "g1 add failed");
    }

    function _g1Mul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
        uint256[3] memory input = [p.x, p.y, s];
        bool success;
        assembly {
            success := staticcall(sub(gas(), 2000), 7, input, 0x60, r, 0x40)
        }
        require(success, "g1 mul failed");
    }
}
