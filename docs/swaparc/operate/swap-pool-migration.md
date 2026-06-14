# Swap pool migration (legacy → StableSwapPoolV2)

One-time migration from the immutable 3-token pool at `0x2F4490…` to the **UUPS upgradeable** proxy deployed via `npm run deploy:swap-pool`. After cutover, all future token listings use `addToken` on the **same proxy address** — no further address changes.

## Addresses

| Role | Address |
|------|---------|
| **Legacy pool** (deprecated after cutover) | `0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC` |
| **Canonical V2 proxy** | See `data/deployments/swap-pool-v2.latest.json` → `proxy` |
| **Implementation** | Same file → `implementation` |

## Token indices (V2 at deploy)

| Index | Symbol | Address |
|-------|--------|---------|
| 0 | USDC | `0x3600000000000000000000000000000000000000` |
| 1 | EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| 2 | SWPRC | `0xBE7477BF91526FC9988C8f33e91B6db687119D45` |
| 3 | CircBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |

Future listings: `addToken(newAddress)` → index `4`, `5`, …

---

## Phase 0 — Deploy V2 (done once)

```bash
npm run deploy:swap-pool
```

Uses `MY_PK` or `ARC_DEPLOYER_PRIVATE_KEY` from `.env`. Records deployment in `data/deployments/swap-pool-v2.latest.json`.

Pool starts with **zero balances** until you seed liquidity (Phase 2).

**Owner wallet:** Deploy script **requires** `MY_PK` = treasury key (`0xD4d3E342902766344075D06c94391e61A9bB7e60`) so deployer and owner on Arcscan match your established treasury. See [Swap pool V2 security](../security-and-privacy/swap-pool-v2-security.md).

---

## Phase 1 — Extract liquidity from legacy pool

Legacy pool has **no owner withdraw**. Use treasury wallet `0xD4d3…` and **chunked `swap()`** on the old pool.

```bash
npm run drain:legacy-pool -- --dry-run
npm run drain:legacy-pool
```

Script: `scripts/drainLegacySwapPool.mjs` — ping-pongs USDC→EURC and EURC→USDC from treasury until pool legs are dust (~500 USDC/EURC).

**Indices (legacy):** USDC=0, EURC=1, SWPRC=2.

---

## Phase 2 — Seed V2 proxy

From treasury (pool **owner**):

1. `approve(V2_PROXY, amount)` for USDC, EURC, SWPRC (and CircBTC if seeding).
2. `addLiquidity([usdc, eurc, swprc, circBtc])` on **V2 proxy** — array length **4**.

Target seed (mirror legacy, adjust for migration loss):

- USDC ~84,905  
- EURC ~70,374  
- SWPRC ~35.66  
- CircBTC — community-agreed seed (can start small)

**V2 advantage:** `ownerWithdraw(i, amount, to)` lets owner pull tokens for ops/migration without swapping.

Verify: `get_dy(0,1,…)`, `get_dy(3,0,…)` (CircBTC ↔ USDC).

---

## Phase 3 — App & backend cutover

Update `.env` / Vercel:

```env
VITE_SWAP_POOL_ADDRESS=<V2_PROXY>
SWAP_POOL_ADDRESS=<V2_PROXY>
```

Files to update (search `0x2F4490` / `SWAP_POOL_ADDRESS`):

- `src/SwaparcApp.jsx` — pool address, `TOKEN_INDICES`, `INITIAL_TOKENS` (+ CircBTC logo)
- `api/indexers/swapIndexer.js`
- `scripts/liveSwapIndexer.js`
- `scripts/countUniqueSwappers.js`
- `lib/swapPoolConfig.js` — export `CANONICAL_SWAP_POOL_ADDRESS` from env or deployment JSON

Ship UI banner: *Legacy pool deprecated — swaps use new address.*

---

## Phase 4 — Landing stats (no egress spike, continuous totals)

### Design principles

| Stat | Source today | After migration |
|------|----------------|-----------------|
| **Volume, swap count, unique users** | Weekly static JSON (`/stats/landing-network.json` or Blob) + Redis **highwater** | **Same** — never reset Redis keys |
| **TVL on landing** | LP `POOLS` balances via RPC once/day | **Unchanged** — swap-pool TVL not in landing TVL today |
| **Page load** | No Railway Redis read | **Keep** static JSON path |

### Indexer continuity

1. **Before cutover:** indexer listens to legacy pool only.
2. **Cutover window (optional 24–48h):** run indexer with **both** addresses writing to the **same** `profile:*` and `leaderboard:*` keys (no duplicate volume — each tx indexed once).
3. **After cutover:** indexer listens to V2 proxy only.

Do **not** delete `stats:landing:highwater:v1`. Weekly cron `buildLandingPublicPayload` already uses `Math.max(observed, previous)` — new swaps **add** to displayed totals; they never regress.

### One-time backfill (optional)

If you want legacy volume fully captured before dual-indexing:

```bash
# Scan legacy pool swap txs into Redis (run once, off-peak)
node scripts/countUniqueSwappers.js
node scripts/liveSwapIndexer.js --backfill-legacy
```

Then run `npm run stats:publish-landing` once — **no** change to landing poll interval (still weekly JSON + daily TVL RPC).

### What users see

- Volume / users / swap count: **monotonic** (highwater preserved).
- No extra Redis reads on homepage.
- TVL: stable daily RPC poll — no spike.

---

## Phase 5 — Future listings (repeatable)

1. Due diligence (contract, decimals, Arcscan verified).
2. `pause()` (optional).
3. `addToken(0xNew…)`.
4. `addLiquidity` with `N`-length array (non-zero on new index).
5. `unpause()`.
6. Update `lib/swapPoolConfig.js` + app allowlist (or read `tokens(i)` from chain).
7. Extend indexer `ADDRESS_TO_SYMBOL`.
8. Announce: *“TOKEN listed on Swaparc swap pool `<proxy>`”* — **same URL forever**.

---

## Phase 6 — Legacy pool

- Mark deprecated in docs and UI.
- Optional: leave dust or swap out over time.
- Do **not** delete contract — explorers and old links may reference it.

---

## Checklist

- [ ] V2 deployed (`data/deployments/swap-pool-v2.latest.json`)
- [ ] Legacy liquidity extracted to treasury
- [ ] V2 `addLiquidity` seeded + quotes tested
- [ ] Env + app point to V2 proxy
- [ ] Indexer on V2 (or dual during window)
- [ ] `stats:publish-landing` after first weekly cron (or manual)
- [ ] Community announcement + Arcscan verify proxy implementation

## Related

- [Jobs & health checks](jobs-and-healthchecks.md) — landing stats cron
- [Pools, pricing, fees](../concepts/pools-pricing-fees.md)
- [Swap](../core-features/swap.md)
