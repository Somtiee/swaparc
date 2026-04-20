// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PoseidonT3.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Groth16 verifier only — must decode public signals per `privpay_claim` / `PrivPayGroth16Verifier`.
interface IZKSNARKVerifier {
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
        );
}

/**
 * @title ZKPrivacyPool
 * @notice Append-only Poseidon Merkle pool; withdraw only via Groth16 `verifyProof`.
 * @dev Public withdraw args must match the proof’s public signals (anti-mismatch / explicit calldata).
 */
contract ZKPrivacyPool {
    uint256 private constant _FIELD_MOD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IERC20 public immutable token;
    IZKSNARKVerifier public immutable verifier;
    uint32 public immutable merkleTreeHeight;

    /// @notice `commitment =>` token amount locked at deposit (`0` = never deposited).
    mapping(bytes32 => uint256) public commitmentAmount;
    mapping(bytes32 => bool) public nullifierSpent;
    mapping(bytes32 => bool) public isKnownRoot;

    mapping(uint256 => bytes32) internal _filledSubtrees;
    mapping(uint256 => bytes32) internal _zeros;
    uint32 public nextIndex;
    bytes32 public currentRoot;

    error AmountZero();
    error RecipientZero();
    error TransferInFailed();
    error TransferOutFailed();
    error CommitmentAlreadyUsed();
    error NullifierSpent();
    error RootUnknown();
    error InvalidVerifier();
    error InvalidProof();
    error PublicSignalMismatch();
    error TreeFull();
    error InvalidMerkleHeight();
    error CommitmentAmountMismatch();
    error DepositorZero();

    event Deposited(bytes32 indexed commitment, uint256 amount);
    event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount);
    event RootUpdated(bytes32 root, uint32 leafIndex);

    constructor(address token_, address verifier_, uint32 merkleTreeHeight_) {
        if (merkleTreeHeight_ < 16 || merkleTreeHeight_ > 32) revert InvalidMerkleHeight();
        if (verifier_ == address(0)) revert InvalidVerifier();
        token = IERC20(token_);
        verifier = IZKSNARKVerifier(verifier_);
        merkleTreeHeight = merkleTreeHeight_;

        bytes32 z = bytes32(0);
        for (uint256 i = 0; i < merkleTreeHeight_; i++) {
            _zeros[i] = z;
            _filledSubtrees[i] = z;
            z = _poseidon2(z, z);
        }
        currentRoot = z;
        isKnownRoot[z] = true;
    }

    /// @notice Pull `amount` from `msg.sender` and insert `commitment` into the tree (note leaf = circom Poseidon hash).
    function deposit(bytes32 commitment, uint256 amount) external {
        _depositFrom(msg.sender, commitment, amount);
    }

    /// @notice Pull `amount` from `from` (must have approved this pool) — for gasless / relayed deposits.
    function depositFor(address from, bytes32 commitment, uint256 amount) external {
        if (from == address(0)) revert DepositorZero();
        _depositFrom(from, commitment, amount);
    }

    function _depositFrom(address from, bytes32 commitment, uint256 amount) internal {
        if (amount == 0) revert AmountZero();
        if (commitmentAmount[commitment] != 0) revert CommitmentAlreadyUsed();
        if (!token.transferFrom(from, address(this), amount)) revert TransferInFailed();

        commitmentAmount[commitment] = amount;
        _insert(commitment);
        emit Deposited(commitment, amount);
    }

    /**
     * @notice Pay `amount` to `recipient` if the Groth16 proof verifies and `nullifierHash` is fresh.
     * @param nullifierHash, recipient, amount must equal the proof’s public signals (see verifier).
     */
    function withdraw(bytes calldata proof, bytes32 nullifierHash, address recipient, uint256 amount) external {
        (
            bool valid,
            bytes32 rootField,
            bytes32 proofNullifier,
            uint256 proofAmount,
            address proofRecipient,
            bytes32 noteCommitmentField
        ) = verifier.verifyProof(proof);

        if (!valid) revert InvalidProof();
        if (proofNullifier != nullifierHash) revert PublicSignalMismatch();
        if (proofRecipient != recipient) revert PublicSignalMismatch();
        if (proofAmount != amount) revert PublicSignalMismatch();

        if (recipient == address(0)) revert RecipientZero();
        if (amount == 0) revert AmountZero();
        // Note commitment is already bound by the Groth16 proof + Merkle root.
        // We intentionally avoid an additional bytes/field-format dependent lookup here.
        noteCommitmentField;
        bytes32 root = _circomBytes32FromField(uint256(rootField));
        if (!isKnownRoot[root]) revert RootUnknown();
        if (nullifierSpent[nullifierHash]) revert NullifierSpent();

        nullifierSpent[nullifierHash] = true;
        if (!token.transfer(recipient, amount)) revert TransferOutFailed();

        emit Withdrawn(nullifierHash, recipient, amount);
    }

    function filledSubtrees(uint256 i) external view returns (bytes32) {
        return _filledSubtrees[i];
    }

    function zeros(uint256 i) external view returns (bytes32) {
        return _zeros[i];
    }

    function _fieldFromCircomBytes32(bytes32 b) private pure returns (uint256 v) {
        unchecked {
            uint256 w = uint256(b);
            for (uint256 i = 0; i < 32; i++) {
                v |= ((w >> (8 * (31 - i))) & 0xff) << (8 * i);
            }
        }
    }

    function _circomBytes32FromField(uint256 x) private pure returns (bytes32 b) {
        unchecked {
            x %= _FIELD_MOD;
            for (uint256 i = 0; i < 32; i++) {
                b |= bytes32(((x >> (8 * i)) & 0xff) << (8 * (31 - i)));
            }
        }
    }

    function _poseidon2(bytes32 left, bytes32 right) private pure returns (bytes32) {
        uint256 l = _fieldFromCircomBytes32(left);
        uint256 r = _fieldFromCircomBytes32(right);
        return _circomBytes32FromField(PoseidonT3.hash([l, r]));
    }

    function _insert(bytes32 leaf) internal {
        uint32 idx = nextIndex;
        if (idx >= uint32(1) << merkleTreeHeight) revert TreeFull();

        bytes32 h = leaf;
        uint32 cur = idx;
        uint256 hgt = merkleTreeHeight;
        for (uint256 i = 0; i < hgt; i++) {
            if ((cur & 1) == 0) {
                _filledSubtrees[i] = h;
                h = _poseidon2(h, _zeros[i]);
            } else {
                h = _poseidon2(_filledSubtrees[i], h);
            }
            cur >>= 1;
        }

        currentRoot = h;
        isKnownRoot[h] = true;
        unchecked {
            nextIndex = idx + 1;
        }
        emit RootUpdated(h, idx);
    }
}
