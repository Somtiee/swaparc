# Security overview

This page explains how SwapArc approaches **safety and trust** in plain language. It is meant to be **accurate**, not promotional. SwapArc is software that talks to **public blockchains** and **standard wallets**; understanding where responsibility sits helps you use it safely.

**Related (deeper dives):** [Threat model](threat-model.md) · [ZK claim security](zk-claim-security.md) · [Key management and backups](key-management-and-backups.md)

It is written for **developers and operators** under **Security & operations** as well as for **end users** who want a single honest map before they read feature-specific pages. Nothing here replaces your own deployment review, contract verification or legal counsel where those apply.

## How user funds are handled

**You stay in control of your keys (in the standard wallet path).** When you connect a normal browser or WalletConnect wallet, **you** approve each transaction. The app proposes calls to smart contracts; it does not move assets unless **your wallet signs**. SwapArc does not take custody of your seed phrase or private keys in that mode.

**Circle email wallet.** If you use Circle’s flow, signing and key management follow **Circle’s user-wallet model** (email, device verification, and challenges). You should read Circle’s own security documentation for how they protect keys and sessions.

**Where tokens actually sit.** For **swaps and LP**, tokens move between **your wallet** and **on-chain pool contracts** according to the transactions you approve. There is no separate “SwapArc balance” in that path. For **PrivPay (privacy pool)**, when you use the privacy-pool rail, tokens are deposited into a **privacy pool contract** on-chain. The recipient later withdraws to **their** wallet using a valid claim flow. Until withdrawal, value is in the **pool contract**, governed by its rules; not in SwapArc’s bank account.

**Relayer (PrivPay).** A configured **relayer** is an automated wallet that can **submit certain transactions** you have already authorized (for example via **EIP-712** signatures for relayed pool actions). It pays **gas** and broadcasts; it is **not** a custodian of your long-term balance in the same sense as an exchange holding your deposit. If the relayer key were compromised, risk is bounded by **what that deployment allows** (for example allowlisted pools and on-chain checks) but **operators must protect that key**. See [Relayer operations](../operate/relayer-operations.md).

## Smart contract considerations

**Code on-chain is the source of truth.** What your wallet signs is enforced by **contracts** on Arc (swap pool, LP pools, privacy pool, etc.), not by marketing copy. Always verify you are on the **correct network** and interacting with **addresses your deployment intends**.

**Upgrades and immutability.** Deployed contracts may be **immutable** or **upgradeable** depending on how they were published. SwapArc documentation does not replace reading **contract verification** on a block explorer and your own or third-party **audits** where available.

**PrivPay proofs.** Claims depend on a **verifier** that must match the **proving artifacts** (for example `wasm` / `zkey`) your frontend uses. If those drift from what is deployed, **claims fail** by design and not by accident. Details: [ZK claim security](zk-claim-security.md).

**Slippage and execution.** The UI shows estimates and limits. **On-chain enforcement** depends on the **exact** pool contract ABI your deployment calls. Do not assume the UI’s “minimum received” is enforced on-chain unless you have verified it for your pool version. See [Swap](../core-features/swap.md).

## Risks users should be aware of

**- Phishing and fake sites.** Only use the **official** SwapArc URL you trust. Malicious sites can ask you to sign **draining** transactions or steal **claim codes**.

**- Claim codes are sensitive.** A **claim code** behaves like a **bearer secret**. Anyone who obtains it and can sign as the **intended recipient** may be able to claim. Do not post codes in public chats, tickets or social media.

**- Testnet vs mainnet.** Much of this project is oriented to **Arc testnet**. Test tokens have **no real monetary value**; procedures and risks differ on mainnet. Treat testnet as **practice infrastructure** that can reset or behave unexpectedly.

**- Smart contract and bridge risk.** Pools can have bugs, economic flaws, or be exploited. **Impermanent loss** and **IL**-style effects apply to liquidity provision. Only supply liquidity or trade amounts you understand.

**- Privacy is not absolute.** The privacy-pool path improves **operational privacy** compared with naive transfers. It does **not** guarantee anonymity against a motivated global adversary, chain analytics or leaks off-chain (for example sharing codes, KYC elsewhere, or correlating IP and wallet). Metadata, timing and relayer/API visibility may still matter depending on threat model.

**- Third parties.** RPC providers, wallets, Circle, and hosting providers may see **some** metadata (for example that you connected, timing, IP at the edge). Your deployment’s privacy posture depends on how those are configured.

**- Relay and backend availability.** If relay or APIs are down, **some** flows may fail or require retry. Funds tied up in **on-chain** positions remain on-chain; UX may degrade.

## Best practices for users

- **Bookmark** the real app URL; double-check the domain before connecting a wallet.
- **Start small** when learning swaps, LP or PrivPay and make sure you confirm behavior on a block explorer.
- **Protect claim codes** like passwords; share only over **end-to-end trusted** channels.
- **Confirm network** (Arc testnet, chain ID) matches what the app expects.
- **Read the transaction preview** in your wallet before signing; reject anything you do not recognize.
- **Back up** any recovery or note material your wallet or PrivPay flows generate, using a **password manager** or offline storage—not screenshots in cloud albums unless encrypted.
- **Disconnect** or lock your wallet when finished on a shared device.
- For **Circle** users, complete security steps promptly and treat **email account** security as wallet security.

## Limitations (transparency)

- SwapArc documentation **does not** certify that any deployment is **bug-free** or **audit-complete**. You use the software **at your own risk**.
- **No insurance** is implied; blockchain transactions are generally **irreversible** once confirmed.
- **Regulatory** treatment of stablecoins, privacy tools and payroll varies by jurisdiction; this is **not legal advice**.
- **Performance and quotes** are estimates; markets and mempools change between quote and confirmation.
- **Profile and leaderboard** data in backends are **not** the same as on-chain balances; they can lag or be wrong if misconfigured.

If you are integrating or operating SwapArc, pair this page with [Threat model](threat-model.md) and your own **internal** risk review.

## Questions or incidents

- **User-facing issues:** [Troubleshooting](../support/troubleshooting.md) · [FAQ](../support/faq.md)
- **Operators:** [Relayer operations](../operate/relayer-operations.md) · [Jobs and health checks](../operate/jobs-and-healthchecks.md)
