# Local development

This guide sits under **Developers & operators** → **Environment & build** alongside [Prerequisites & environment](../getting-started/prerequisites-and-environment.md). It walks you from a clean checkout to a running dev stack on **Arc testnet**, with emphasis on what to validate locally before you rely on hosted infrastructure. For environment variable semantics and relay-related secrets, keep [Prerequisites & environment](../getting-started/prerequisites-and-environment.md) open in another tab; for contract layout and deploy scripts, see [Contracts & architecture](contracts-and-architecture.md); for PrivPay HTTP surfaces used during relay and claim testing, see [API: PrivPay](api-reference-privpay.md).

## Prerequisites

You should already be on **Node.js 18+** with **npm** available in your shell, because the repository’s scripts and lockfile assume that toolchain. **Arc testnet RPC access** is non-negotiable for both the browser bundle and any server routes that read chain state; without it, installs succeed but every screen that touches balances or logs will stall or error. Finally, ensure **`.env` values are configured from `.env.example`** so `npm run dev` boots with consistent RPC, pool addresses, and optional relay or Circle settings; partial configuration is the most common cause of “works on CI but not on my laptop” drift.

## Install and run

```bash
npm install
npm run dev
```

`npm install` hydrates dependencies exactly as lockfile pins them; if it fails, fix Node version and network before changing application code. `npm run dev` starts the Vite dev server with the API routes your feature needs co-located in the same runtime. Treat the first successful load as the baseline before you add new env toggles.

## Recommended development workflow

1. Configure network and pool env vars first.
2. Start frontend and API runtime.
3. Connect wallet in standard mode.
4. Validate swap and pools flows.
5. Validate PrivPay claim context and relay paths.
6. Test Circle mode only after Circle credentials are configured.

That order is deliberate: **network and pool variables** establish which contracts and RPC endpoints both client and server agree on, so you are not debugging wallet UX while chain ID or pool addresses are wrong. Once the **frontend and API runtime** are up, **standard wallet mode** is usually the fastest way to confirm signing, gas and token metadata end-to-end—see [Connect a wallet](../getting-started/connect-a-wallet.md) if labels or flows differ from what you expect. **Swap** and **pools** exercises prove the core AMM path before you touch ZK-heavy code. **PrivPay claim context** and **relay paths** exercise indexing, proof artifacts and optional relayer signing; when `VITE_PRIVACY_POOL_USE_RELAY` and related secrets are set, cross-check behavior with [Relayer operations](../operate/relayer-operations.md) so you are not surprised by allowlists or rate limits in production-shaped settings. **Circle mode** should come last because it depends on client and server Circle credentials being present and consistent—chasing OTP or challenge issues before core chain connectivity is stable wastes time.

## ZK proving assets

When testing **claim** flows, ensure the browser can load:

- `VITE_PRIVPAY_WASM_URL`
- `VITE_PRIVPAY_ZKEY_URL`

Those URLs must resolve to the **WASM** and **zkey** artifacts your deployment expects the prover to use. If artifacts do not match deployed verifier, claims fail at verification. In practice that surfaces as generic “proof invalid” or verification errors rather than a revert message you can grep from a swap. During local work, serve artifacts from `public/` or another origin you control, clear cache when you rotate keys and verify the artifact set matches the verifier wired to your privacy pool deployment before you spend time debugging application logic.

## Docs in the app

The in-app documentation viewer renders Markdown with a simple parser: **pipe tables** appear as monospace blocks, not HTML tables. For layout-critical tables, prefer the repo markdown in an external renderer or duplicate key fields as lists.

When you edit docs under `docs/swaparc/`, preview dense tables in GitHub, your editor or another full Markdown renderer, then keep in-app pages readable by repeating critical columns as prose or definition-style lists where needed.

## Local safety checklist

- Use test-only relayer keys.
- Keep allowlist restricted to test pool addresses.
- Never store production secrets in local files.

Treat this list as non-negotiable whenever `PRIVACY_POOL_RELAYER_PRIVATE_KEY`, relay secrets, or production pool addresses appear in documentation examples. If you need production-like behavior locally, use a dedicated throwaway key and pools that cannot move mainnet-value; never copy live **`.env`** lines into a shared machine or commit history.
