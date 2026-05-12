# First swap & liquidity

Before starting, [connect a wallet](connect-a-wallet.md) and confirm you have Arc testnet **native gas**. If needed, review [Networks and glossary](../introduction/networks-and-glossary.md) and [FAQ](../support/faq.md).

This guide covers one successful first swap and one basic liquidity action.

## Execute your first swap

1. Open the **Swap** tab.
2. Select a token in **Sell** and a different token in the receive field.
3. Enter a positive amount.
4. Review the trade preview:
   - Quoted output
   - Price impact
   - Slippage setting
5. If a high-impact warning appears, continue only if that result is intentional.
6. Click **Swap** and complete signing.

## Swap guardrails

- Amount must be positive.
- Sell and receive tokens must be different.
- Wallet balance must cover the sell amount.
- Very large swaps may be blocked by pool safety checks.

## Add liquidity

1. Open **Pools**.
2. Select a pool pair.
3. Enter deposit amounts.
4. Approve token spending if prompted.
5. Confirm **Add Liquidity**.
6. Wait for confirmation, then review your position.

## Remove liquidity

1. Open **Pools** and go to **My Positions**.
2. Select a position and click **Remove**.
3. Enter the LP amount to remove.
4. Confirm the transaction.
5. Verify updated balances and position value.

## Important notes

- Use conservative trade size when liquidity is thin.
- Keep slippage tight under normal market conditions.
- In Circle mode, expect a short challenge/confirmation step before broadcast.
