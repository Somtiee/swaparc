# PrivPay

PrivPay is SwapArc’s payment module for **Bills**, **Payroll** and **Claim** flows. It lets teams initiate payouts in-app and when deployment conditions are met, route settlement through a **ZK privacy pool** so recipients claim with proof instead of relying only on public transfer traces.

For how proofs, nullifiers and relay authorization work under the hood, see [ZK claim security](../security-and-privacy/zk-claim-security.md).

## Feature modules

PrivPay has three user-facing modules:

- **Bills** — create and track one-off payable entries.
- **Payroll** — manage recurring or queued payouts to recipients.
- **Claim** — complete recipient-side settlement using shared claim material.

In practice, payer actions happen in Bills/Payroll, while recipient finalization happens in Claim.

![PrivPay Bills and Payroll interface with payout creation and upcoming items](/docs-images/privpay-bills-payroll.png)

## When the privacy pool is used

PrivPay routes a payment through the **ZK privacy pool** only when both routing prerequisites are satisfied in the current deployment:

- The selected token has a configured privacy-pool address for that asset.
- The payment includes a non-empty recipient wallet address.

If either condition fails (missing recipient wallet or no configured pool for that token), the app does **not** use the privacy-pool rail for that payment.

## Payment lifecycle (summary)

The lifecycle is payer-first, recipient-finalized:

1. Payer creates and executes a Bill or Payroll entry.
2. If privacy-pool routing applies, funds are deposited and the app returns **claim material** (for example a base64 claim code).
3. Recipient opens **PrivPay → Claim → Payments Claim**, uses the matching recipient wallet and completes proving plus settlement.

## End-to-end flow (payer and recipient)

From start to finish:

1. Payer creates the payment item and executes it in-app.
2. On success, payer receives a **recipient claim code** (treat as bearer secret).
3. Payer shares the code with the intended recipient over a secure channel (never public chat or support tickets).
4. Recipient connects the same wallet address configured for that payment, pastes the code in **PrivPay → Claim → Payments Claim** and runs proving plus submission.
5. Either side can verify settlement on Arc testnet: `https://testnet.arcscan.app/tx/<hash>` (see also [FAQ](../support/faq.md)).

## Before you claim (recipient checklist)

Before running claim, verify:

- Wallet is on **Arc testnet**.
- Connected address matches the recipient encoded in claim material.
- Claim code is complete and unmodified.
- Claim code is handled as sensitive secret data.

## Claim paths (code, QR scan, receipt image)

Recipients can use any of these in **PrivPay → Claim → Payments Claim**; all paths decode the same **v3 zk-claim** base64 payload (`poolClaimCode`) and run the same on-chain claim logic:

| Method | What to do |
| --- | --- |
| **Paste code** | Paste the base64 claim code from the payer receipt. |
| **Upload image** | Upload a PrivPay receipt JPEG or a photo of the receipt QR (the app reads the QR, not OCR of the text). |
| **Scan QR** | Use the device camera on the receipt QR; the code is prefilled in Paste mode for you to review before claiming. |

Steps after the code is loaded:

1. Confirm the connected wallet matches the recipient encoded in the claim material.
2. Tap **Claim** and wait for proving plus submission (do not share the QR or code publicly).
3. Confirm success in **Claim history** and optionally on [Arcscan](https://testnet.arcscan.app).

**QR security:** The QR encodes the **exact same bearer secret** as the pasted claim code (including note preimage fields in v3 exports). Scanning does not bypass wallet checks, relay authorization, or nullifier rules; it is only a different transport.

If a claim code is too long for QR capacity, the receipt shows **copy code only** (no broken QR). You can still paste or share the code directly.

## Receipt export (CSV vs JPEG)

- **CSV** (Bills/Payroll history): accounting-friendly rows, including claim codes where present; same as before.
- **JPEG** (receipt modal or history **Export JPEG**): human-readable branded receipt with summary fields and an embedded claim QR when the payload fits.

Payers should share JPEG or code only over a **secure channel** intended for the recipient.

## Relay and execution (standard wallet)

For **standard (browser) wallet** flows, privacy-pool **withdraw** is often submitted via the **relay** (`POST /api/privpay/privacy-pool-relay`): the recipient signs **EIP-712** relay authorization and the relayer broadcasts `withdraw` — this avoids common wallet nonce and broadcast edge cases while keeping funds controlled by proof + nullifier rules on-chain.

**Circle email wallet** flows use the app’s Circle execution path for the corresponding contract calls. Configuration (for example `VITE_PRIVACY_POOL_USE_RELAY`) affects whether deposits use relay in some setups.

## Fees and gas

- All signed actions (swaps, liquidity operations, pool deposits/withdrawals and claims) require **native Arc USDC as testnet gas** in the signing wallet.
- Some PrivPay flows may apply a small **USDC usage fee** to the configured treasury; always review the in-app confirmation summary before signing.

## Notes for teams

- Treat claim material as sensitive bearer data; loss or exposure can create direct fund risk.
- Back up note/claim data according to your security policy.
- Keep one internal runbook for common claim failures (for example nullifier spent, root unknown or proof mismatch) so support and ops respond consistently.
