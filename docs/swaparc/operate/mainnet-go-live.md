# Arc Mainnet Go-Live Runbook

> Owner runbook for switching SwapARC from Arc testnet to Arc mainnet with
> **Option A (LP-first launch)** + **Option B (operator seeds the stableswap)**.
> Read it top to bottom once BEFORE mainnet day; every command is copy-paste.

---

## 0. The strategy (why this runbook looks like this)

- **The stableswap (Swap tab) needs operator liquidity.** `StableSwapPoolV2.addLiquidity`
  is `onlyOwner` — until the owner seeds it, every swap reverts. The UI already
  handles this: the Swap tab shows a **"Liquidity bootstrapping"** notice
  (checking on-chain balances every 60s) and hides the swap form until the
  pool has liquidity. You do NOT need to time the seeding with the deploy.
- **Per-pair pools (Pools tab) bootstrap themselves.** `SwaparcPoolV2.addLiquidity`
  is public — the first depositor anchors the ratio, everyone after follows the
  min-rule. No capital needed from you. This is **Option A**.
- **Option B**: seed the stableswap with whatever you can afford
  (`npm run seed:swap-pool`), then reward early LPs with
  `npm run rewards:fund`.

**No code changes are needed for mainnet.** Everything network-specific is
env-driven (see §2). Code is already committed and deployed.

---

## 1. Pre-flight: facts to collect (ONLY from official Arc sources)

Get these from Arc's official announcements (arc.network site, their official
X/Discord announcements, or the Arc docs). **Never from DMs, random tutorials,
or forum posts** — a fake RPC or token address is a classic phishing vector,
and pasting one here sends your users' transactions (and your treasury's) to
an attacker.

| Fact | Where it goes (env) |
|---|---|
| Mainnet chain ID | `ARC_CHAIN_ID` (VPS + Vercel) and `VITE_ARC_CHAIN_ID` (Vercel) |
| Mainnet public RPC | `ARC_PUBLIC_RPC_URL` + `VITE_ARC_PUBLIC_RPC_URL` |
| Mainnet dRPC endpoint | `ARC_DRPC_RPC_URL` + `VITE_ARC_DRPC_RPC_URL` |
| Mainnet explorer base URL | `ARC_EXPLORER_URL` + `VITE_ARC_EXPLORER_URL` |
| Official USDC / EURC / SWPRC / CircBTC mainnet addresses | `ARC_TOKEN_*` + `VITE_ARC_TOKEN_*` |
| Gas: does the treasury 0xD4d3… hold mainnet ARC? | (needed for deploys) |

Notes:

- **SWPRC** is your own token. If you deploy a fresh mainnet SWPRC, its
  address comes from YOUR deploy output, not from Arc.
- **CircBTC / EURC** — verify each address against Circle's official
  mint listings, not just Arc's announcement.
- Double-check the chain ID against what `cast chain-id` / the explorer says
  once you have the RPC — typos in chain IDs mean every wallet prompt fails.

---

## 2. Where each env var lives

Three places, all must agree:

| Where | Vars | Effect |
|---|---|---|
| **Vercel → Settings → Environment Variables** (then REDEPLOY) | all `VITE_*` | browser: wallet network add/switch, explorer links, token list, pool list, swap-tab bootstrap check |
| **Vercel env (same place)** | `ARC_*` (non-VITE) | API routes (claim scan RPCs, subscription claims, indexer route) |
| **VPS `/root/swaparc/.env`** then `docker compose up -d --build` | all `ARC_*` + `ARC_RPC_URL` | server: recurring autopay, swap indexer, stats |

Source of truth in code:

- Browser: `src/config/arcNetwork.js`
- Server: `lib/arcNetwork.js` (token addresses flow into `lib/lpPoolsConfig.js`
  and `lib/swapPoolConfig.js`)

Everything defaults to testnet, so you can set the vars any time before the
switch — nothing changes until the values are live.

---

## 3. Deploy order on mainnet day

Run from your local repo with `.env` pointed at mainnet (set `ARC_RPC_URL`
and `MY_PK`; `MY_PK` must be the treasury key 0xD4d3…, the same one that owns
the testnet contracts).

### 3.1 Deploy the stableswap (Option B prerequisite)

```bash
ARC_RPC_URL=<mainnet-rpc> npm run deploy:swap-pool
```

- Writes `data/deployments/swap-pool-v2.latest.json` (proxy + implementation).
- The script refuses to deploy if the deployer has zero gas.
- Record the **proxy** address → `ARC_SWAP_POOL_ADDRESS` (VPS + Vercel) and
  `SWAP_POOL_ADDRESS` (VPS; used by the indexer/stats).

### 3.2 Deploy the per-pair LP pools (Option A)

```bash
ARC_RPC_URL=<mainnet-rpc> npm run deploy:lp-pools-circbtc
```

- On mainnet (any non-testnet chain) it deploys **all six pairs**
  (USDC/EURC, USDC/SWPRC, EURC/SWPRC, USDC/CircBTC, EURC/CircBTC, SWPRC/CircBTC).
- Writes `data/deployments/lp-pools-circbtc.latest.json` and **prints a
  single-line JSON** at the end.
- Paste that JSON as `ARC_LP_POOLS_JSON` (VPS) and `VITE_ARC_LP_POOLS_JSON`
  (Vercel). The Pools tab reads it; if it's missing on mainnet the Pools tab
  is empty.

### 3.3 Seed the stableswap (Option B)

```bash
ARC_RPC_URL=<mainnet-rpc> npm run seed:swap-pool -- --dry-run   # preview + ratios
ARC_RPC_URL=<mainnet-rpc> npm run seed:swap-pool                # broadcast
```

- Uses the default ratio (USDC anchor U: EURC = U/1.4, SWPRC = U/9,
  CircBTC = U/1,000,000) capped by your treasury balances, or set
  `SEED_USDC_ANCHOR=500` / `SEED_CUSTOM=1` for explicit amounts.
- Needs the treasury to hold all four tokens on mainnet. If you can only
  afford USDC + a couple: `SEED_CUSTOM=1 SEED_USDC=… SEED_EURC=… SEED_SWPRC=… SEED_CIRCBTC=…`
  (human units; set 0 for tokens you skip — swaps touching those legs stay
  locked until more LP arrives).
- The Swap tab unlocks automatically once USDC liquidity ≥ the bootstrap
  threshold — no redeploy, no refresh needed by users.

### 3.4 Fund LP rewards (Option A sweetener — optional but recommended)

Per-pair rewards only pay out of the owner-funded reserve, so this is how you
make "be the first LP" attractive:

```bash
# preview everything (default):
ARC_RPC_URL=<mainnet-rpc> REWARDS_AMOUNT=500 npm run rewards:fund
# broadcast:
ARC_RPC_URL=<mainnet-rpc> REWARDS_AMOUNT=500 npm run rewards:fund -- --apply
```

- `REWARDS_AMOUNT` is human units of each pool's FIRST token (USDC for
  usdc-* pools, EURC for eurc-swprc, SWPRC for swprc-circbtc).
- Tune the rate with `REWARDS_RATE=` (raw `rewardRatePerSecond`; contract
  default `1e14`). Budget check: rewards accrue at
  `rate × LP tokens held × seconds` per LP, capped by the reserve — set the
  rate so `rate × total LP supply × campaign days` stays inside the funded
  reserve, or claims will just drain it early.
- Single pool only: `REWARDS_POOL_ID=usdc-eurc`.

### 3.5 Flip the app to mainnet

1. Vercel env: set all `VITE_ARC_*` + `ARC_*` mainnet values (§1 table),
   set `VITE_SWAP_POOL_ADDRESS` to the mainnet proxy from §3.1, and
   `VITE_TESTNET_SUNSET=0` (takes the sunset screen down).
2. Vercel: **Redeploy** (VITE vars are baked at build time).
3. VPS `.env`: set the `ARC_*` server values + `ARC_RPC_URL`,
   `SWAP_POOL_ADDRESS=<mainnet proxy>`, `SWAP_POOL_V2_FROM_BLOCK=<mainnet
   deploy block>`, then `docker compose up -d --build`.
4. Indexer note: the KV checkpoint `swapIndexer:v2:lastBlock` is per-network
   state shared between testnet/mainnet. After cutover, set
   `SWAP_POOL_V2_FROM_BLOCK` to the mainnet deploy block and clear the old
   checkpoint inside the container:
   ```bash
   docker compose exec app node -e "import('./lib/server/kv.js').then(async ({kv}) => { await kv.del('swapIndexer:v2:lastBlock'); console.log('checkpoint cleared'); })"
   ```
   The indexer then starts scanning from the new from-block. Testnet profile
   stats stay in KV untouched — they're keyed per user, not per network.

### 3.6 Verify (go/no-go checklist)

- [ ] swaparc.app loads mainnet app (no sunset screen)
- [ ] Wallet connect prompts to add/switch to the mainnet chain (correct chain ID)
- [ ] Swap tab: bootstrap notice **gone** if seeded; swaps work end-to-end
- [ ] Pools tab: six pools listed with correct mainnet addresses; a small
      test `addLiquidity` from a non-owner wallet works
- [ ] Explorer links point at the mainnet explorer and resolve
- [ ] VPS: `docker compose logs -f app | grep -i indexer` shows the indexer
      heartbeating and advancing blocks
- [ ] Landing stats resume climbing after the first mainnet swaps

---

## 4. What NOT to do

- **Don't rush the stableswap seed before the tokens/addresses are verified.**
  Wrong token in the pool = seed is stuck (ownerWithdraw exists but users
  would see a broken pool).
- **Don't turn the sunset screen off until Vercel is redeployed with the
  mainnet `VITE_*` values** — otherwise users hit a mainnet-labeled app
  pointed at testnet RPC.
- **Don't reuse testnet checkpoints**: clear the indexer checkpoint as in §3.5.
- **Don't trust any address sent to you in DMs**, even if the display name
  looks official. Cross-check against arc.network / Circle's published lists.

## 5. Rollback

If something is broken after the flip:

1. Vercel: remove/comment the `VITE_ARC_*` values, restore
   `VITE_TESTNET_SUNSET=1` (or just unset it — default is on for production
   builds), redeploy. The sunset screen returns; the testnet app is reachable
   via the escape-hatch link again.
2. VPS: restore the old `.env` (keep a pre-cutover copy:
   `cp .env .env.pre-mainnet`), `docker compose up -d --build`.

The on-chain side needs no rollback: mainnet contracts are fresh and empty
until you seed/fund them.

---

## Appendix: quick env template (fill from official sources)

```bash
# ── Vercel (browser + API) ──────────────────────────────
VITE_TESTNET_SUNSET=0
VITE_SWAP_POOL_ADDRESS=            # mainnet stableswap proxy (from 3.1)
VITE_ARC_CHAIN_ID=
VITE_ARC_CHAIN_NAME=Arc
VITE_ARC_PUBLIC_RPC_URL=
VITE_ARC_DRPC_RPC_URL=
VITE_ARC_EXPLORER_URL=
VITE_ARC_TOKEN_USDC=
VITE_ARC_TOKEN_EURC=
VITE_ARC_TOKEN_SWPRC=
VITE_ARC_TOKEN_CIRCBTC=
VITE_ARC_LP_POOLS_JSON=            # from deploy:lp-pools-circbtc output
ARC_CHAIN_ID=
ARC_PUBLIC_RPC_URL=
ARC_DRPC_RPC_URL=
ARC_EXPLORER_URL=
ARC_TOKEN_USDC=
ARC_TOKEN_EURC=
ARC_TOKEN_SWPRC=
ARC_TOKEN_CIRCBTC=
ARC_LP_POOLS_JSON=
ARC_SWAP_POOL_ADDRESS=

# ── VPS .env (server) ───────────────────────────────────
ARC_RPC_URL=                       # mainnet RPC (scripts + server)
ARC_CHAIN_ID=
ARC_PUBLIC_RPC_URL=
ARC_DRPC_RPC_URL=
ARC_EXPLORER_URL=
ARC_TOKEN_USDC=
ARC_TOKEN_EURC=
ARC_TOKEN_SWPRC=
ARC_TOKEN_CIRCBTC=
ARC_LP_POOLS_JSON=
ARC_SWAP_POOL_ADDRESS=
ARC_SWAP_POOL_OWNER_ADDRESS=
SWAP_POOL_ADDRESS=                 # same as ARC_SWAP_POOL_ADDRESS (indexer/stats)
SWAP_POOL_V2_FROM_BLOCK=           # mainnet deploy block
```
