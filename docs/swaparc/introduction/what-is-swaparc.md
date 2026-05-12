# What is SwapArc

**SwapArc** is a decentralized application on **Arc testnet** for:

- **Stablecoin swaps** — trade supported assets from the Swap experience.
- **Liquidity** — provide and manage LP positions in configured pools.
- **PrivPay** — create bills or payroll, then send and claim through the **ZK privacy-pool** flow.

## Wallet modes

Use a **standard wallet** (browser extension or WalletConnect-compatible session) for direct signing or an optional **Circle email wallet** for email, OTP and managed signing when that fits your users.

**New here?** Start with [How SwapArc works](how-swaparc-works.md)—a short product tour before you dive deeper.

## Core capabilities

- **Swap** — Exchange supported assets from the **Swap** tab; routing and limits follow the deployed contracts and UI configuration.
- **Pools** — Add liquidity, monitor LP value and remove positions per pool rules.
- **PrivPay** — Create **Bills** or **Payroll** items, complete payment, then have recipients **claim** through the privacy-pool path.
- **Profile and leaderboard** — View swap volume and related activity surfaced in the app.

## Network and environment

- **Network:** Arc testnet (primary environment for the product as documented here).
- **Default RPC (read):** `https://rpc.testnet.arc.network`
- **Default chain ID:** `5042002` (unless your deployment overrides it).

## Privacy model at a glance

**PrivPay** private receive runs on a **ZK privacy pool**: funds deposit into a token-specific pool, the recipient receives **claim material**, the browser builds a **Groth16** proof and settlement invokes **`withdraw`** on the pool; often via a **relay** with **EIP-712** authorization. This documentation does **not** present legacy alternate receive mechanics as a first-class end-user feature.

**Read next:** [PrivPay private receive (ZK)](../concepts/privpay-private-receive-zk.md) → [PrivPay (how to use)](../core-features/privpay.md) → [ZK claim security](../security-and-privacy/zk-claim-security.md).

## Who should use this documentation

- **End users** — [Getting started](../getting-started/getting-started.md) and **Core features** (Swap, Pools, PrivPay).
- **Integrators and builders** — **Build** and **Security and privacy** sections, plus API references where you integrate with backends.
- **Operators** — **Operate** and **Support** runbooks (relay, jobs, troubleshooting).
