# Threat model

For a user- and stakeholder-oriented overview, start with [Security overview](security.md). This page summarizes practical risks and controls for SwapArc. For PrivPay claim invariants and logging discipline, see [ZK claim security](zk-claim-security.md).

It is aimed at **developers and operators** under **Security & operations** who own deployment configuration, secrets and incident response. Pair it with [Relayer operations](../operate/relayer-operations.md) and [PrivPay relay & API](../build/api-reference-privpay.md) for concrete relay headers, allowlists and HTTP semantics; use [Key management and backups](key-management-and-backups.md) for how secrets should live outside the repo.

## Assets to protect

Operators should treat **user wallet signing authority** as the root of custody in standard-wallet flows: anything that can trick a user into signing the wrong calldata can move funds within whatever allowances and approvals exist. **Claim material**; **note preimage**, **claim code** and **backup data** is effectively bearer capability for PrivPay-style withdrawals and recovery; loss or exfiltration shifts risk from “RPC down” to “funds or privacy lost.” The **relayer private key** gates automated submission for pool actions the deployment has scoped; compromise does not rewrite on-chain rules, but it can burn gas and stress allowlists and monitoring within whatever the relayer is permitted to call. 

Finally, **Redis/KV data** linked to **profiles** and **payment workflows** holds operational state and sometimes sensitive blobs; it is not a substitute for chain truth, but it can leak PII, enable replay against weak endpoints, or break payouts when poisoned.

## Primary trust boundaries

SwapArc’s security story is easiest to reason about when you name where trust changes hands. The first boundary is **browser client vs API routes**: the browser sees public config and user actions; API routes see server secrets, rate limits and raw request bodies. Anything that treats the client as honest beyond signed payloads is a design smell. 

The second is **API routes vs relayer signer**: handlers validate typed data and policy, then the relayer EOA signs transactions. Misalignment between those layers shows up as “400 in logs but txs still broadcast” or the opposite, depending on bug class. 

The third is **off-chain context generation vs on-chain proof verification**: Merkle paths and claim context from RPC/KV must match what the pool and verifier enforce. The chain is the final judge and off-chain helpers are only safe when their outputs are checked or redundant with consensus state.

## Key threats

- **Relayer key compromise:** attacker can attempt unauthorized relay broadcasts within configured scopes.
- **Misconfigured allowlist:** invalid pool acceptance or rejected valid requests.
- **Leaked claim material:** unauthorized claim attempts.
- **Signature mismatch/replay attempts:** invalid typed-data reuse or stale deadlines.
- **Dependency outage:** Redis/KV/RPC outages degrade relay and indexing behavior.

Each row above should map to monitoring or config checks in staging before production: for example, **allowlist** mistakes are configuration bugs with security impact; **dependency outage** is availability that becomes a safety issue when users retry unsafe paths or operators bypass controls under pressure.

## Existing controls

The deployment already leans on several compensating mechanisms. **EIP-712 signer checks** bind relay actions to the intended principal for deposit and withdraw flows. **Deadline validation** with a **bounded future window** limits how long a captured signature remains valid. **Nullifier spent checks on-chain** prevent duplicate claims once a note has been spent. **Pool allowlist enforcement in the relay layer** stops the relayer from being aimed at arbitrary pool contracts by unprivileged callers. **Rate limiting per IP and action** reduces brute-force and abuse volume against relay and context endpoints. None of these removes the need for good key hygiene; they stack.

## Recommended production controls

Run **dedicated relayer wallets** with **strict key handling** (HSM or vault-backed material, no shared laptops, separate from deployer keys). **Enforce secret management with rotation policies** for relay server secrets, API keys and third-party tokens so a single paste into chat does not become permanent access. **Restrict and monitor RPC providers** so you detect provider-wide failures, unexpected chain tips or abnormal `eth_call`/`getLogs` error rates early. **Enable alerting for relay error spikes and repeated signature failures**, which often precede abuse or a mis-typed verifier rollout. **Define incident runbooks for claim failures and rate-limit anomalies** so on-call engineers know when to pause relaying, roll back config or communicate to users without improvising under fire.
