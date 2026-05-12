# ZK claim security

This page covers **threat-relevant invariants** and operational discipline for PrivPay claims. **User flow:** [PrivPay](../core-features/privpay.md). **Concepts:** [PrivPay private receive (ZK privacy pool)](../concepts/privpay-private-receive-zk.md).

It is written for **developers and operators** under **Security & operations** who ship proving bundles, wire relay authorization or debug claim failures in production. Read it together with [Threat model](threat-model.md) for where trust boundaries sit, [Security overview](security.md) for end-user framing and [PrivPay relay & API](../build/api-reference-privpay.md) for HTTP-level relay rules.

## What must hold for a valid claim

A claim is only sound when the **proving artifacts** (`wasm` and `zkey`) match the **deployed verifier** paired with the pool. If they do not, the verifier rejects the proof before any payout path completes. Operators should treat version skew between CDN or `public/` assets and deployed bytecode as a release-blocking defect, not a client-only issue.

Independently, **`withdraw` calldata** must match **proof public signals** (**root**, **nullifier**, **amount**, **recipient**, **commitment** as enforced by the pool). Any desynchronization between what the wallet or relay submits and what the proof attests to should revert or fail verification rather than paying out the wrong tuple.

The Merkle **root** must be **known** to the pool (**historical roots / sync**): off-chain path construction can be ahead or behind chain state briefly, but the pool only authorizes spends against roots it recognizes. The **nullifier** must be **unused** (**single successful claim per note**); that enforces one successful spend of the note’s withdrawal path on-chain.

Failures surface on-chain as invalid proof, public signal mismatch, unknown root, or nullifier already spent. See [Troubleshooting](../support/troubleshooting.md).

## Relay-specific controls

**EIP-712** relay authorization binds **signer**, **pool**, **amount** and **deadline**; the relayer only broadcasts after verification. **Pool allowlists** restrict which pool addresses the relayer will call. Optional **shared secret** header behavior for relay is documented in [PrivPay relay & API](../build/api-reference-privpay.md).

## Observability

Do not log full proofs, note preimages, or raw claim payloads in production. Use **sanitized** hints only (pool id, action, status codes).
