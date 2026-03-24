// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title StealthPayments
/// @notice Announcement contract for one-time stealth payments.
/// @dev Sender computes stealth address off-chain via ECDH and funds it.
///      This contract emits announcement data (ephemeral pubkey + view tag)
///      so receiver can scan and detect payments.
contract StealthPayments {
    event StealthPaymentAnnounced(
        address indexed stealthAddress,
        address indexed token, // address(0) for native token
        uint256 amount,
        bytes ephemeralPubKey, // compressed or uncompressed secp256k1 pubkey
        bytes1 viewTag,        // optional 1-byte scan hint
        bytes32 metadataHash   // hash pointer for encrypted off-chain metadata
    );

    error InvalidEphemeralPubKeyLength();
    error NativeAmountMustBePositive();
    error TokenTransferFailed();

    function announceNativePayment(
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes1 viewTag,
        bytes32 metadataHash
    ) external payable {
        if (ephemeralPubKey.length != 33 && ephemeralPubKey.length != 65) {
            revert InvalidEphemeralPubKeyLength();
        }
        if (msg.value == 0) revert NativeAmountMustBePositive();

        (bool ok, ) = stealthAddress.call{value: msg.value}("");
        if (!ok) revert TokenTransferFailed();

        emit StealthPaymentAnnounced(
            stealthAddress,
            address(0),
            msg.value,
            ephemeralPubKey,
            viewTag,
            metadataHash
        );
    }

    function announceERC20Payment(
        address token,
        address stealthAddress,
        uint256 amount,
        bytes calldata ephemeralPubKey,
        bytes1 viewTag,
        bytes32 metadataHash
    ) external {
        if (ephemeralPubKey.length != 33 && ephemeralPubKey.length != 65) {
            revert InvalidEphemeralPubKeyLength();
        }
        bool ok = IERC20(token).transferFrom(msg.sender, stealthAddress, amount);
        if (!ok) revert TokenTransferFailed();

        emit StealthPaymentAnnounced(
            stealthAddress,
            token,
            amount,
            ephemeralPubKey,
            viewTag,
            metadataHash
        );
    }
}

