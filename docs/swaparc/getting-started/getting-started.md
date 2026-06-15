# Getting started

This page gets you from zero to your first successful action on SwapArc. For a fast product overview, read [How SwapArc works](../introduction/how-swaparc-works.md).

## 1. What SwapArc is

**SwapArc** is a web app on **Arc testnet** for:

- Trading supported stablecoins.
- Managing liquidity positions.
- Running **PrivPay** flows (bills, payroll, and private-claim payouts).

You sign with your own wallet, either directly or through the optional Circle email flow.

## 2. Requirements

Before you begin, confirm this checklist:

- **Arc testnet network**
  - Default chain ID is **`5042002`**.
  - Your wallet must be on the same network as the app.
- **Native gas token**
  - Required for swaps, liquidity actions, and claims.
  - Use in-app **Get Faucet** (or your preferred Arc testnet faucet) if your balance is empty.
- **Supported wallet**
  - Standard browser wallet / WalletConnect-compatible path, or **Connect via Gmail / Email** (Circle).
  - Wallet setup details: [Connect a wallet](connect-a-wallet.md).
- **Test tokens (optional)**
  - Needed for swap and pools (for example USDC / EURC / SWPRC / CircBTC on testnet).
  - Source them from faucet or another testnet holder.

For normal usage, you do not need to run your own node. If you host your own instance, read [Prerequisites & environment](prerequisites-and-environment.md).

![SwapArc connected on Arc testnet with Get Faucet and Swap panel visible](/docs-images/getting-started-swaparc.png)

## 3. Step-by-step first use

🔹 **Open the official app**
  - Use only a trusted SwapArc URL.

🔹 **Connect your wallet**
  - Click **CONNECT**, approve access, and switch to **Arc testnet** if prompted.

  - Wallet-specific flow: [Connect a wallet](connect-a-wallet.md).

🔹 **Fund gas if needed**
  - Use **Get Faucet** and wait for native balance to update.

🔹 **Execute a small first action**
  - Recommended: open **Swap**, choose different tokens, enter a small amount, review quote/slippage, then sign.
  - Alternative: open **Profile** and confirm your address and stats load.

🔹 **Verify on-chain (optional)**
  - Paste the transaction hash into [Arcscan](https://testnet.arcscan.app).

**Next:** [First swap and liquidity](first-swap-and-liquidity.md) · [PrivPay](../core-features/privpay.md) · [FAQ](../support/faq.md)

## 4. Common mistakes to avoid

1. **Wrong network** — Switch wallet to **Arc testnet** and refresh if balances or transactions look wrong.
2. **No gas** — Fund native token before swap, liquidity, or PrivPay actions.
3. **Skipping wallet preview** — Review transaction details before signing; reject anything unexpected.
4. **Oversized first trade** — Start small. Thin liquidity increases price impact, and oversized trades may be blocked.
5. **Sharing PrivPay claim codes** — Treat claim codes like secrets. Share only through private channels.
6. **Wrong claim wallet** — The connected wallet must match the intended recipient wallet for claim flows.
7. **Assuming testnet assets are real funds** — Testnet tokens are for testing and integration rehearsal only.

## Safety note

Read [Security overview](../security-and-privacy/security.md) for custody model, risks, and operational best practices.
