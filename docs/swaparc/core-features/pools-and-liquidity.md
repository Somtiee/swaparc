# Pools & liquidity

The **Pools** tab manages **LP pools** (per-pair liquidity). This is distinct from the single **swap pool** used by the [Swap](./swap.md) tab. If you need a quick model of swap pool vs LP pool behavior, see [Networks and glossary](../introduction/networks-and-glossary.md).

Before interacting with pools, complete [Connect a wallet](../getting-started/connect-a-wallet.md). The feature supports add/remove liquidity flows for each configured pool pair.

![Pools tab with My Positions and All Pools views](/docs-images/pools-my-positions.png)

## Add liquidity

Adding liquidity follows a simple sequence: 
- Connect Wallet 
- Open **Pools** tab 
- Pick a target pair 
- Enter deposit amounts
- Approve token spend if the wallet asks, then 
- Confirm **Add Liquidity**.

After the transaction confirms, your position and LP value should update in the interface. If values do not refresh immediately, re-open the pool view after a short delay and verify the transaction hash on the explorer.

![Deposit Liquidity form with token amounts and Supply Liquidity action](/docs-images/pools-deposit-liquidity.png)

## View positions

Use **My Positions** as your operational dashboard for LP exposure. For each position, review the assets in the pair, the estimated LP value and whether a remove action is available.

This view is the fastest way to confirm that a recent add/remove action settled as expected.

## Remove liquidity

To exit or reduce exposure: 
- Open **My Positions**
- Select a position 
- Enter the LP amount to remove and 
- Confirm the transaction. 
Once confirmed, verify that returned token balances are reflected in your wallet and in-app balances. When testing, start with a partial removal first. This makes it easier to validate expected token return behavior before executing a full exit.

![Remove Liquidity form with LP percentage controls and token outputs](/docs-images/pools-remove-liquidity.png)

## Operational notes

LP value moves as market prices and pool balances change, so position value is dynamic even when you take no action. In thinner pools, entry and exit can show larger value swings because each trade moves the pool state more noticeably.

If you use Circle mode, expect an additional verification/challenge phase before final broadcast. Wait for one action to complete before initiating another.
