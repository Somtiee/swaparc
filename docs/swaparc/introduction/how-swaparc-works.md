# How SwapArc works

Short tour of the product. For **swap pool** vs **LP pool** and other terms; see [Networks and glossary](networks-and-glossary.md). For hands-on setup, see [Getting started](../getting-started/connect-a-wallet.md).

## 1. High-level explanation

**SwapArc** is a web app on **Arc testnet** that combines three capabilities:

- **Swap** — Exchange supported stablecoins through the app’s **swap pool**; execution price depends on pool depth and configuration.
- **Pools** — Supply **liquidity** to **LP pools** (paired deposits). You earn fees from activity while exposed to normal market and impermanent-loss risk.
- **PrivPay** — Run bills and payroll through a **ZK privacy-pool flow**: funds enter a shared pool; the recipient **withdraws** using claim material and a proof instead of a chain of plain address-to-address transfers.

**Signing:** use a **standard wallet** (injected provider or WalletConnect-compatible session) or a **Circle email wallet** (email, OTP and occasional security challenges).

## 2. Step-by-step flow

### Swap

1. Connect on **Arc testnet** (correct chain in your wallet).
2. Choose sell / buy tokens and amount.
3. Review quote, warnings and slippage.
4. Sign; the app routes the trade through the **swap pool**.

### Pools (liquidity)

1. Open **Pools**, select a pair and deposit per the UI.
2. Your position is in that pair’s **LP pool** (separate from the swap venue used for spot trades).
3. Remove liquidity when you want to exit; you receive your share of the pool per contract rules.

### PrivPay (private receive)

1. Payer creates a bill or payroll item and completes the on-chain payment step.
2. When the **privacy pool** path applies, the payer receives a **claim code** (claim material the recipient must use to withdraw).
3. Recipient opens **PrivPay → Claim**, enters the code and finishes the flow: the browser builds the **ZK proof**, then the app submits or **relays** the withdrawal per configuration.

## 3. What happens behind the scenes

- The chain only sees **transactions**, not intent. The UI maps your actions to **contract calls** (swap, add/remove LP, pool deposit, pool withdraw).
- **PrivPay withdrawals** use **zero-knowledge proofs**: the contract checks a valid proof and public signals **without** publishing the secret note on-chain. Backend services may supply **history** (for proof inputs) and **relay** broadcast; they do **not** replace your wallet as the signing authority for authorized spends.
- **Profile and leaderboard** data are stored in backend **KV** (for example Redis), keyed by user or wallet—separate from token balances on-chain.

## 4. Why it is beneficial

- **Single surface** for stablecoin swaps, liquidity and PrivPay-style payouts.
- **Operational privacy** on the PrivPay path: the ZK privacy-pool flow reduces naive on-chain linkage between payer activity and recipient receipt versus repeated public sends.
- **Flexible custody of signing**: self-custody wallet or Circle email flows, depending on your users.
- **Arc testnet** is a controlled environment to exercise treasury-style flows before production-grade deployments.

**Summary:** SwapArc is a **stablecoin operations desk** on Arc—**swap**, **pool liquidity**, and optionally **PrivPay** through a **pool-and-proof** path so recipients **claim with cryptography**, not only with public transfers.

## Where to go next

- [What is SwapArc?](what-is-swaparc.md)
- [PrivPay (feature)](../core-features/privpay.md)
- [PrivPay private receive (concepts)](../concepts/privpay-private-receive-zk.md)
