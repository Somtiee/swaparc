# Networks & glossary

## Supported network

SwapArc targets **Arc testnet** by default.

- **Chain ID:** `5042002` (default unless your deployment overrides it).
- **Block explorer:** `https://testnet.arcscan.app`
- **Default read RPC:** `https://rpc.testnet.arc.network`

**Gas** — Keep USDC the Arc testnet **native token** in the wallet that signs transactions. You pay gas for swaps, liquidity changes, pool deposits and claims. The app surfaces a **faucet** link in the header when you need test funds.

Confirm your wallet is on the **same network** as the app and any **relayer** you rely on.

## Token and pool model

Each supported asset (**USDC**, **EURC**, **SWPRC**, **CircBTC**) maps to three distinct on-chain contexts:

1. **Swap pool** — One **AMM** contract backing the **Swap** tab for quotes and spot trades.
2. **LP pools (preset pools)** — Per-pair contracts under **Pools** for add/remove liquidity and position tracking. They are **not** the same contracts as the swap pool.
3. **Privacy pool** — A token-scoped **ZK privacy pool** used by **PrivPay** private receive (deposits and proof-based `withdraw`).

In documentation, say **swap pool**, **LP pool**, or **privacy pool.** **Pool** alone is ambiguous.

## Terminology: PrivPay vs private receive

- **PrivPay** — The in-app product surface: **Bills**, **Payroll** and **Claim**.
- **Private receive** — The payout rail: deposit → shared claim material (for example a **claim code**) → recipient proves and **withdraws** from the privacy pool.

## Glossary

- **AMM** — Automated market maker contract used for pricing and swaps.
- **Swap pool** — Primary on-chain venue for the Swap tab (one configured contract address).
- **LP pool / preset pool** — A paired liquidity pool shown under **Pools** (its own contract and LP token mechanics).
- **LP** — Liquidity provider; deposits into LP pools and holds LP exposure.
- **PrivPay** — SwapArc flows for private payments: Bills, Payroll, and Claim.
- **ZK privacy pool** — Contract rail where deposits settle and **Groth16** proof-based withdrawals execute.
- **Claim code** — Portable payload the payer shares with the recipient for claiming; treat as a **secret**—any party with the code and a compatible wallet path may be able to claim.
- **Groth16 proof** — Zero-knowledge proof format generated in the browser for valid withdrawals.
- **Note preimage** — Private claim material used to build witnesses and proofs.
- **Commitment** — On-chain commitment tied to a privacy-pool deposit.
- **Nullifier** — Single-use scalar that prevents double-claims.
- **Relayer** — Server-side signer or broadcaster for allowed privacy-pool relay actions.
- **EIP-712 authorization** — Typed structured data signature authorizing relayed actions.
- **Claim context** — Merkle path and root data (commonly from `GET /api/privpay/claim-context`) required to assemble a valid witness and proof.
- **WalletConnect** — Supported connection path alongside injected browser wallets in standard wallet mode.

## Important usage notes

- Each **nullifier** may succeed **once**; a second claim with the same spent nullifier fails by design.
- Browser **verifier artifacts** (`wasm` / `zkey`) must match the **deployed verifier** or proofs will not verify.
- **Wrong pool address** or **wrong network** is a frequent cause of failed claims—double-check both before debugging deeper.
