# Troubleshooting

Use this matrix to diagnose common SwapArc issues.

## Wallet and login issues

### Standard wallet does not connect

- Confirm wallet extension is installed and unlocked.
- Confirm wallet is on Arc testnet.
- Reload app and reconnect.

### Circle flow stalls on challenge

- Confirm `VITE_CIRCLE_APP_ID` and server Circle credentials are valid.
- Re-run login and complete OTP/challenge steps.
- Check Circle backend endpoint logs for challenge status failures.

## Swap and pool issues

### Swap rejected due to size or impact

- Reduce trade amount.
- Check pool liquidity.
- Re-quote with updated slippage.

### Liquidity tx fails

- Confirm token approvals.
- Confirm wallet balance and gas balance.
- Retry after network confirmation lag clears.

## PrivPay claim issues

### Invalid proof / public signal mismatch

- Ensure proving artifacts match deployed verifier.
- Ensure claim context corresponds to the same pool/network.

### Root unknown

- Confirm `poolAddress` and chain are correct.
- Verify context scan start block (`VITE_PRIVACY_POOL_FROM_BLOCK`) and RPC freshness.

### Nullifier spent

- Claim already completed for this note.
- Use new payment/claim material for another transfer.

### Relay returns 401/403/429/503

- `401`: signature mismatch or secret-gated unauthorized request.
- `403`: pool not allowlisted.
- `429`: rate limit exceeded; retry later.
- `503`: relay key, RPC, allowlist, or rate-limit store config issue.

## Operations escalation checklist

1. Capture timestamp, wallet mode, tx hash and endpoint response.
2. Confirm environment values for chain, pool and relay settings.
3. Verify relayer account health and RPC connectivity.
4. Escalate with sanitized logs only (no claim secrets/proofs).
