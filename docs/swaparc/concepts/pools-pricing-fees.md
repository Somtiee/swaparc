# Pools, Pricing, and Fees

This page explains **pricing concepts** for the **Swap** tab and **LP positions**. For step-by-step actions, see [Swap](../core-features/swap.md) and [Pools and liquidity](../core-features/pools-and-liquidity.md).

## Two different “pools”

- **Swap pool:** The single AMM the **Swap** tab uses for spot trades and quotes.
- **LP pools (preset pools):** The per-pair contracts under the **Pools** tab where you add or remove liquidity.

Do not assume the same contract serves both; reserves and risk differ by venue.

## How swap prices are formed

The app reads on-chain reserves from the **swap pool** and quotes output before you sign.

Your outcome depends on:

- Current reserves in that pool.
- Trade size relative to liquidity.
- Any movement between quote time and confirmation.

## Price impact

**Price impact** is how much your trade moves the price away from the ideal spot quote for that size.

- Smaller trades in deeper pools → lower impact.
- Larger trades in thin pools → higher impact.

The app warns on high impact and may require explicit confirmation for very high-impact trades.

## Slippage (concept)

**Slippage** is how much worse than the quoted output you are willing to tolerate if state changes before execution.

- **Too low:** higher chance the UI or chain rejects or the user experience feels “stuck” if others trade first.
- **Too high:** you may accept a much worse fill.

How slippage appears in the UI and what is enforced **on-chain** for your deployment is covered in [Swap](../core-features/swap.md).

## Liquidity provision (LP pools)

Liquidity providers deposit into **LP pools** and receive LP exposure. Returns and risk depend on:

- Volume and fees through that LP pool.
- How the relative prices of the pair move over time.

This is separate from merely swapping on the **swap pool**.

## Safety guidelines

- Avoid very large swaps when the **swap pool** is thin (see also the app’s liquidity cap in [Swap](../core-features/swap.md)).
- Verify token pair and amount before signing.
- Recheck quotes if execution is delayed.
