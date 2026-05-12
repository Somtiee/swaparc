# PrivPay Private Receive (ZK Privacy Pool)

Canonical **concept** page for how private receive works. For **in-app steps** see [PrivPay](../core-features/privpay.md). For **security and invariants** see [ZK claim security](../security-and-privacy/zk-claim-security.md).

PrivPay private receive uses a privacy-pool model backed by Groth16 proof generation and on-chain proof verification.

## Conceptual flow

1. A payer deposits funds to a token-specific privacy pool commitment.
2. The recipient receives claim material (claim code or note-derived preimage).
3. The recipient generates a proof in browser.
4. A `withdraw` call is submitted (directly or through relay).
5. The pool verifies proof and nullifier, then transfers funds to recipient.

## Claim model components

- **Commitment:** Represents deposit state in the pool.
- **Note preimage:** Private material required for witness/proof generation.
- **Merkle root:** Historical root proving membership in pool state.
- **Nullifier hash:** Single-use value preventing duplicate claims.
- **Proof:** Groth16 proof checked by the pool verifier.

## Why nullifiers matter

A successful claim marks the nullifier as spent. Any replay attempt with the same nullifier fails, preventing double-withdrawal.

## Relay authorization model

For relayed actions, the app uses EIP-712 typed-data signatures:

- Withdraw authorization is signed by the recipient.
- Deposit authorization is signed by the depositor.

This allows relayer broadcast without surrendering user private keys.

## Important warning

Claim material (claim code/note data) is sensitive.
Anyone with valid claim material and matching authorization capability may attempt a claim.

Store claim data securely and never post it in public channels.
