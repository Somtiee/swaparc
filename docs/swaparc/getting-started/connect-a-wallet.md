# Connect a wallet

SwapArc supports two signing modes: a **standard wallet** (injected provider or WalletConnect-compatible session) and a **Circle email wallet** provisioned for your account. Choose the mode that matches how you want to handle key management and transaction approval. For a fuller comparison, read [Wallet vs email connect](wallet-vs-email-connect.md).

![Connect wallet modal with Connect Wallet and Connect via Gmail options](/docs-images/connect-wallet-cta.png)

## Standard wallet

Use this mode if you control keys in a wallet app or hardware device.

1. Choose **Connect via Wallet** (or the equivalent control in the header).
2. Approve the connection in your wallet (extension or WalletConnect-compatible mobile wallet).
3. Switch to **Arc testnet** when prompted.
4. Confirm the connected address shown in the UI.

All transactions are approved in your wallet. If no provider is detected, the app returns a connection error.

## Circle email wallet

Use this mode if you prefer Circle’s email and device-verification flow instead of running a separate extension wallet.

1. Choose **Connect via Gmail** or **Connect via Email** (labels match what the app shows).
2. Complete email verification and OTP steps.
3. Complete any Circle security challenge presented by the flow.
4. Wait until the UI shows your wallet as ready before submitting trades or PrivPay actions.

The app processes **one contract-heavy action at a time** to avoid overlapping signing challenges.

## Choosing a mode

- **Standard wallet** — Maximum direct control: you manage keys, chain switching and WalletConnect sessions.
- **Circle email wallet** — Lower local setup: signing includes Circle verification and challenge steps.

## Troubleshooting

- **Standard wallet**
  - Ensure wallet extension/app is installed, unlocked and connected.
  - Confirm the wallet network is **Arc testnet**.
- **Circle email wallet**
  - Verify Circle is configured correctly for this deployment.
  - Complete OTP and any security challenge windows fully before retrying.
- **Both modes**
  - Keep sufficient Arc testnet **native gas ($USDC)** for transaction fees.
  - Ensure token balances are available for the action you are attempting.
