# Swap

The **Swap** tab exchanges one supported token for another using quotes from the on-chain **swap pool**. This pool is separate from LP pair contracts in the **Pools** tab; see [Networks and glossary](../introduction/networks-and-glossary.md) for the model.

Before swapping, complete [Connect a wallet](../getting-started/connect-a-wallet.md). Swap works with a standard wallet path (including WalletConnect-compatible flows) and the Circle email wallet path.

![Swap tab with token selection, amount entry, and quote metrics](/docs-images/swap-quote-panel.png)

## User flow

A standard swap is straightforward: connect, open **Swap**, choose source and destination tokens, enter an amount, review quote/slippage/price impact, then sign and submit.

In practice, the most important step is review. Confirm token direction, amount, and expected receive before signing. This is where most avoidable mistakes are caught.

## Validation behavior

Before execution, SwapArc validates core constraints. 

1. The input amount must be positive
2. Source and destination tokens must differ
3. Your balance must be sufficient and 
4. Pool data must be available.

SwapArc also enforces an internal liquidity protection rule. The app rejects trades where the sold amount would exceed roughly **10% of the swap pool balance** for that sold asset. This prevents oversized trades from forcing thin-liquidity execution.

## Slippage and quotes

The UI shows two key numbers: an estimated receive amount and a **minimum received** value derived from your slippage setting.

Important: depending on deployment build, the swap pool contract may not enforce that minimum on-chain for every path. The transaction uses the deployed pool’s `swap` interface as implemented in your environment. Treat minimum received as a **UI risk guide** unless you have verified contract-level enforcement for your specific pool version. If execution is delayed or market state changes, re-quote and sign again with updated values. 

## Price impact confirmation

When price impact is very high, SwapArc may require explicit acceptance before enabling execution. Continue only when you intentionally accept the execution risk and resulting rate.

![High price-impact confirmation checkbox before execution](/docs-images/swap-high-impact-confirmation.png)

## Wallet modes

With a **standard wallet**, signing occurs in your wallet app (injected provider or WalletConnect path). With the **Circle email wallet**, signing may include Circle verification and challenge steps. Wait for the UI to complete one action before starting another.

## Best practices

Start test and first-time trades with small size, keep slippage conservative unless you intentionally accept higher execution variance and re-quote before signing whenever timing or market conditions change.

![Successful swap confirmation modal with sent and received amounts](/docs-images/swap-success-modal.png)
