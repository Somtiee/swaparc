# Circle Enterprise Layer (USDC + Wallet Services)

This module adds a production-oriented integration layer around Circle User-Controlled Wallet APIs for SwapArc/PRIVPAY.

## Why Circle improves reliability

- Managed wallet lifecycle reduces key-handling complexity on clients.
- Challenge-based transaction flow adds deterministic transaction states (`challengeId` -> tx status).
- Built-in idempotency support prevents accidental duplicate submissions in retry scenarios.
- Circle infrastructure standardizes execution and signing for users without injected wallets.

Circle does not replace your chain RPC strategy. It complements it by making wallet operations and transaction signing more reliable at the wallet-service layer.

## How Circle combines with stealth payments

Stealth logic (ECDH derivation, ephemeral key generation, view-tag strategy) stays application-side.

Execution split:

1. App derives stealth outputs:
   - `stealthAddress`
   - `ephemeralPubKey`
   - `viewTag`
   - optional `metadataHash`
2. Backend calls Circle contract execution API using user wallet:
   - token approval (if needed)
   - `StealthPayments.announceERC20Payment(...)`
3. App or backend resolves challenge status via:
   - `/api/circle/user/challenge-status`

This keeps stealth privacy semantics while outsourcing signing/execution reliability to Circle.

## Implemented endpoints

### 1) Wallet Services Summary

`POST /api/circle/enterprise/wallet-services`

Body:

```json
{
  "userToken": "<circle_user_token>"
}
```

Returns normalized wallet list and default wallet.

### 2) USDC Transfer Execution

`POST /api/circle/enterprise/execute-usdc-transfer`

Body:

```json
{
  "userToken": "<circle_user_token>",
  "walletId": "<wallet_id>",
  "to": "0xReceiverAddress",
  "amount": "12.5",
  "tokenAddress": "0x3600000000000000000000000000000000000000",
  "decimals": 6,
  "feeLevel": "MEDIUM"
}
```

Triggers contract execution for ERC20 transfer:
`transfer(address,uint256)`.

### 3) Stealth Payment Execution

`POST /api/circle/enterprise/execute-stealth-payment`

Body:

```json
{
  "userToken": "<circle_user_token>",
  "walletId": "<wallet_id>",
  "stealthPaymentsAddress": "0xStealthPaymentsContract",
  "tokenAddress": "0x3600000000000000000000000000000000000000",
  "stealthAddress": "0xOneTimeStealthAddress",
  "amount": "100.00",
  "decimals": 6,
  "ephemeralPubKey": "0x02...",
  "viewTag": "0xab",
  "metadataHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "feeLevel": "MEDIUM"
}
```

Triggers contract execution for:
`announceERC20Payment(address,address,uint256,bytes,bytes1,bytes32)`.

## Operational notes

- Keep `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` server-side only.
- Use `idempotencyKey` for retry-safe transaction creation.
- Poll challenge state until onchain hash is resolved.
- Keep RPC fallback strategy for reads/indexing; Circle focuses on execution/signing reliability.

