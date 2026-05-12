# Overview

SwapArc is a web3 application on the **Arc network** focused on **stablecoin swaps**, **liquidity pools** and **PrivPay**; private receive and payout flows backed by a **ZK privacy-pool** design. Together, these three areas cover trading, market making, and confidential on-chain settlement without replacing standard wallet custody models.

**Swap** — Trade supported stablecoins against the app’s **swap pool** routes. The UI surfaces quotes, slippage, and execution steps; pricing and pool behavior follow the deployed contracts and the configured asset set on Arc. Use this when you need to move between tokens the protocol lists for spot exchange.

**Pools** — Add or remove **liquidity** in the LP pools the deployment exposes, subject to pool rules (fees, caps, and pair wiring). This is how participants supply depth to the markets Swap routes against and earn fee share according to the pool’s mechanics.

**PrivPay** — Send and receive through a **privacy pool** path: funds move into the pool, recipients use **claim material** and a **ZK proof** to withdraw to a chosen address. It supports use cases such as payroll, invoices, and private receive where you want **claim-time** privacy and nullifier-based replay protection rather than a public transfer graph for every leg.

For concepts and limits, see [Swap](core-features/swap.md), [Pools & liquidity](core-features/pools-and-liquidity.md), and [PrivPay](core-features/privpay.md); the ZK route is summarized under [PrivPay & private receive (ZK)](concepts/privpay-private-receive-zk.md).

## How this documentation is organized

The in-app sidebar separates two tracks on purpose:

- **User guide** — product usage: wallets, swaps, LP, PrivPay in the UI, and support.
- **Developers & operators** — repositories, deployment, contracts, HTTP APIs, relay configuration, and operational jobs.

If you are not shipping software or running infrastructure, follow the **User guide** path until you need the technical sections.

## Start here

### User guide

- **New to SwapArc**
  - [How SwapArc works](introduction/how-swaparc-works.md) → [What is SwapArc?](introduction/what-is-swaparc.md) → [Networks & glossary](introduction/networks-and-glossary.md)
- **First actions**
  - [Getting started](getting-started/getting-started.md) → [Connect a wallet](getting-started/connect-a-wallet.md) → [Wallet vs email connect](getting-started/wallet-vs-email-connect.md) → [First swap & liquidity](getting-started/first-swap-and-liquidity.md)
- **Features**
  - [Swap](core-features/swap.md) → [Pools & liquidity](core-features/pools-and-liquidity.md) → [PrivPay](core-features/privpay.md)
- **Help**
  - [FAQ](support/faq.md) → [Troubleshooting](support/troubleshooting.md)

### Developers & operators

- **Environment**
  - [Prerequisites & environment](getting-started/prerequisites-and-environment.md) → [Local development](build/local-development.md) → [Contracts & architecture](build/contracts-and-architecture.md)
- **APIs**
  - [API: PrivPay](build/api-reference-privpay.md) → [API: Profile & system](build/api-reference-profile-and-system.md)
- **Security & operations**
  - [Security overview](security-and-privacy/security.md) → [Threat model](security-and-privacy/threat-model.md) → [ZK claim security](security-and-privacy/zk-claim-security.md) → [Key management & backups](security-and-privacy/key-management-and-backups.md) → [Relayer operations](operate/relayer-operations.md) → [Jobs & health checks](operate/jobs-and-healthchecks.md)

---

## Documentation map

Source files under `docs/swaparc/`:

- **Introduction**
  - [How SwapArc works](introduction/how-swaparc-works.md) — `introduction/how-swaparc-works.md`
  - [What is SwapArc](introduction/what-is-swaparc.md) — `introduction/what-is-swaparc.md`
  - [Networks & glossary](introduction/networks-and-glossary.md) — `introduction/networks-and-glossary.md`
- **Getting started**
  - [Getting started](getting-started/getting-started.md) — `getting-started/getting-started.md`
  - [Connect a wallet](getting-started/connect-a-wallet.md) — `getting-started/connect-a-wallet.md`
  - [Wallet vs email connect](getting-started/wallet-vs-email-connect.md) — `getting-started/wallet-vs-email-connect.md`
  - [First swap & liquidity](getting-started/first-swap-and-liquidity.md) — `getting-started/first-swap-and-liquidity.md`
  - [Prerequisites & environment](getting-started/prerequisites-and-environment.md) — `getting-started/prerequisites-and-environment.md`
- **Concepts**
  - [Pools, pricing & fees](concepts/pools-pricing-fees.md) — `concepts/pools-pricing-fees.md`
  - [PrivPay & private receive (ZK)](concepts/privpay-private-receive-zk.md) — `concepts/privpay-private-receive-zk.md`
- **Core features**
  - [Swap](core-features/swap.md) — `core-features/swap.md`
  - [Pools & liquidity](core-features/pools-and-liquidity.md) — `core-features/pools-and-liquidity.md`
  - [PrivPay](core-features/privpay.md) — `core-features/privpay.md`
- **Build**
  - [Local development](build/local-development.md) — `build/local-development.md`
  - [Contracts & architecture](build/contracts-and-architecture.md) — `build/contracts-and-architecture.md`
  - [API: PrivPay](build/api-reference-privpay.md) — `build/api-reference-privpay.md`
  - [API: Profile & system](build/api-reference-profile-and-system.md) — `build/api-reference-profile-and-system.md`
- **Security and privacy**
  - [Security overview](security-and-privacy/security.md) — `security-and-privacy/security.md`
  - [Threat model](security-and-privacy/threat-model.md) — `security-and-privacy/threat-model.md`
  - [ZK claim security](security-and-privacy/zk-claim-security.md) — `security-and-privacy/zk-claim-security.md`
  - [Key management & backups](security-and-privacy/key-management-and-backups.md) — `security-and-privacy/key-management-and-backups.md`
- **Operate**
  - [Relayer operations](operate/relayer-operations.md) — `operate/relayer-operations.md`
  - [Jobs & health checks](operate/jobs-and-healthchecks.md) — `operate/jobs-and-healthchecks.md`
- **Support**
  - [FAQ](support/faq.md) — `support/faq.md`
  - [Troubleshooting](support/troubleshooting.md) — `support/troubleshooting.md`

## Product scope and terminology

- **PrivPay** — Private receive and related confidential on-chain flows, documented as a **ZK privacy-pool** sequence: deposit → claim material → proof → `withdraw`.
- **Scope** — Alternate or legacy receive paths that may exist in the repository are **not** described here as first-class product surfaces.
- **Wallets** — **Standard wallet** (injected providers and WalletConnect-compatible sessions) and **Circle email wallet** are the supported signing models.

## Audience guide

- **End users** — Follow **Start here** (User guide), then [Getting started](getting-started/getting-started.md) and the core feature pages for Swap, pools, and PrivPay.
- **Integrators** — Use **Build** and **Security and privacy**, plus [API: PrivPay](build/api-reference-privpay.md) and [API: Profile & system](build/api-reference-profile-and-system.md) for HTTP contracts.
- **Operators** — Use **Operate** (relay configuration, secrets, and health checks) together with [Security overview](security-and-privacy/security.md) and [ZK claim security](security-and-privacy/zk-claim-security.md) for deployment discipline.
