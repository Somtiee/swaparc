# FAQ

Common questions about SwapArc on Arc testnet: wallets, gas, PrivPay, pools, and troubleshooting.

## Do I need native tokens for gas?

Yes. On Arc testnet, swaps, liquidity changes, privacy-pool actions, and claims require **$USDC as gas** in the wallet that signs. Use the in-app faucet entry or your usual testnet faucet if you are short on gas.

## Which assets does SwapArc support in the UI?

The app is wired to a **fixed set of tokens** (for example USDC, EURC, SWPRC on Arc testnet) and separate addresses for **swap pool**, **LP pools** and **privacy pools** per asset where configured. See [Networks and glossary](../introduction/networks-and-glossary.md).

## What wallet options are supported?

- **Standard wallet:** Injected providers and **WalletConnect**-compatible connections.
- **Circle email wallet:** Email verification, OTP and Circle challenges instead of a local extension.

Details: [Connect a wallet](../getting-started/connect-a-wallet.md).

## Is a PrivPay receipt QR less secure than pasting the claim code?

No. The QR on a receipt contains the **same v3 zk-claim string** as the base64 code. Treat QR images, JPEG exports, and pasted codes as **equally sensitive** bearer secrets. Anyone who obtains the material can attempt a claim if they also control the recipient wallet. Uploading a receipt image does not weaken on-chain checks; it only avoids manual copy/paste.

## Why did my PrivPay claim fail with an “already claimed” or nullifier error?

The **nullifier** for that note was already consumed in a successful `withdraw`. Nullifiers are **single-use**; you need a **new payment and new claim material** for another payout.

## Why did I get a root, proof, or verifier error?

Common causes:

- Wrong **network** or wrong **pool address** for the token.
- **Claim context** still catching up or RPC out of sync (retry after a short wait).
- Browser **wasm/zkey** artifacts that do not match the **deployed verifier**.

See [Troubleshooting](troubleshooting.md).

## Is the relay required for every PrivPay step?

No. **Deposit** and **withdraw** may use relay depending on configuration and wallet path. In typical **standard-wallet** flows, **withdraw** often goes through the relay for reliable broadcast while the recipient still authorizes via **EIP-712**. See [PrivPay](../core-features/privpay.md) and [PrivPay relay & API](../build/api-reference-privpay.md).

## Can I use SwapArc without Circle?

Yes. **Standard wallet** mode is fully supported. Circle requires extra client and server configuration.

## How do I verify a transaction?

Open the transaction on Arcscan:

`https://testnet.arcscan.app/tx/<hash>`

## Documentation scope (legacy receive paths)

This documentation set describes **PrivPay private receive** through the **ZK privacy-pool** rail. Other historical or alternate receive mechanics in the repository are **out of scope** for these guides unless explicitly added for operators.
