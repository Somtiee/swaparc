# StableSwapPoolV2 — security posture

This page describes the **design, trust model, and review status** of the upgradeable swap pool (`StableSwapPoolV2` + ERC-1967 proxy). It is **not** a substitute for an independent third-party audit.

## Status

| Item | Status |
|------|--------|
| Third-party audit | **Not completed** — budget for a formal audit before mainnet-scale TVL |
| Internal / AI-assisted review | **Yes** — OpenZeppelin patterns, reentrancy guards, SafeERC20, fee cap |
| Verified on Arcscan | **Recommended** after each implementation deploy |
| Bug bounty | **Not live** — consider before production |

## Architecture (what users trust)

```text
Users / Swaparc app
        │
        ▼
  ERC-1967 Proxy  ← permanent address (holds token balances)
        │
        ▼
  StableSwapPoolV2 implementation (replaceable via UUPS upgrade)
```

- **Proxy address** never changes after cutover — listings and integrations stay stable.
- **Implementation** can be upgraded **only by `owner`** (`_authorizeUpgrade`).
- **Owner** at deploy should be the Swaparc treasury (`0xD4d3…`) for continuity with PrivPay and on-chain history.

## What the contract can do

| Function | Who | Risk if misused |
|----------|-----|------------------|
| `swap` | Anyone (when unpaused) | Normal AMM risk; no admin drain via swap |
| `addLiquidity` | Owner | Owner must approve tokens; increases pool reserves |
| `ownerWithdraw` | Owner | **Can pull pooled tokens** — ops/migration only; use multisig |
| `addToken` | Owner | New listing slot; must seed liquidity separately |
| `pause` / `unpause` | Owner | Halts swaps during incidents or listings |
| `upgradeTo` (UUPS) | Owner | **Can replace all logic** — highest trust assumption |

## Safety features in V2

- **OpenZeppelin UUPS** + `Initializable` (no constructor state on implementation).
- **`ReentrancyGuard`** on `swap`, `addLiquidity`, `ownerWithdraw`.
- **`SafeERC20`** for transfers (handles non-standard ERC-20 return values).
- **Decimal normalization** (`rates[]`) so USDC (6), CircBTC (8), SWPRC (18) share one math path.
- **`MAX_FEE_BPS = 100`** — fee set at initialize cannot exceed 1% without a new deploy.
- **`pause`** — emergency stop on swaps.
- **Duplicate token guard** on `addToken`.
- **Liquidity checks** on swap (`dy=0`, `pool balance`).

## Residual risks (honest)

1. **Owner key compromise** — attacker could upgrade implementation, withdraw reserves, or pause indefinitely. **Mitigation:** hardware wallet → multisig (Safe) → timelock on upgrades for production.
2. **Upgrade storage collision** — bad V3 layout could corrupt balances. **Mitigation:** follow OpenZeppelin upgradeable storage rules; test upgrades on testnet; never reorder existing slots.
3. **StableSwap math edge cases** — very imbalanced pools or extreme trade sizes can quote poorly. **Mitigation:** app slippage + liquidity caps; seed listings with sane ratios.
4. **Malicious `addToken`** — owner could list a worthless or malicious ERC-20. **Mitigation:** listing SOP, community announcement, allowlist in UI.
5. **No on-chain TWAP / oracle** — prices are pool-internal only.

## Recommended production hardening

1. Deploy with **treasury** `0xD4d3E342902766344075D06c94391e61A9bB7e60` as deployer + owner.
2. **Verify** implementation + proxy on [Arcscan](https://testnet.arcscan.app).
3. Move owner to **multisig** before large TVL migration.
4. Add **timelock** (e.g. 48h) on `upgradeTo` before production.
5. Commission a **third-party audit** when TVL justifies cost.
6. Document every **`addToken`** and upgrade in public ops notes.

## Upgradeable & listings

- **Yes — upgradeable** via UUPS (`owner` authorizes new implementation).
- **Yes — new tokens** via `addToken(address)` then `addLiquidity` with an `N`-length array.
- **Same proxy address** for all future listings — no new swap venue per token.

## Related

- [Swap pool migration](../operate/swap-pool-migration.md)
- [Threat model](threat-model.md)
- [Security overview](security.md)
