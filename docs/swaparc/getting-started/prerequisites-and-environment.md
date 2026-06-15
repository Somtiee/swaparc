# Prerequisites & environment

This page is the **environment and build** entry point for **developers and operators** who run SwapArc locally, extend the UI, or wire server-side features such as the privacy-pool relayer. It complements the deeper build walkthrough in [Local development](../build/local-development.md), contract and deployment notes in [Contracts & architecture](../build/contracts-and-architecture.md) and PrivPay HTTP behavior in [API: PrivPay](../build/api-reference-privpay.md). If you are only connecting a wallet in a hosted deployment, you may prefer [Connect a wallet](connect-a-wallet.md) and [Wallet vs email connect](wallet-vs-email-connect.md); everything below assumes you are working from a checkout and intend to run `npm` scripts against **Arc testnet**.

## Before you begin

Running the app and its server routes reliably requires **Node.js 18+** together with **npm** as the package manager the repository expects. You also need **access to an Arc testnet RPC** endpoint so both the Vite dev server and any Node-side code that reads `process.env` can reach the same chain the UI targets.

For signing during development you will configure **one** of two paths, matching how production users connect.

**- Standard wallet mode** expects a **browser wallet** (injected provider or WalletConnect-compatible client) so you can approve transactions against **Arc testnet** from your machine. 

**- Email wallet mode** instead requires **Circle app credentials** so the Circle-backed flow can provision signing without a traditional extension. You do not need both on day one, but teams often keep a browser wallet handy even when Circle is enabled, to compare flows or debug calldata.

## Clone and install

Clone your fork or the upstream repository, then install dependencies:

```bash
git clone https://github.com/Somtiee/swaparc.git
cd swaparc
npm install
```

If you use a fork, substitute your fork URL for the `git clone` target. After `npm install` completes, you have the same dependency tree CI uses; if installs fail, fix Node version and registry access before touching application code.

## Configure environment

Copy **`.env.example`** to **`.env`** and set values required for your use case. Treat `.env` as secrets-bearing: never commit it and keep production values out of screenshots or support threads. The example file groups related toggles; the subsections below mirror the **minimum conceptual map** most developers need before first `npm run dev`. For variables not listed here, search the repo for `process.env` and `import.meta.env` when you enable a specific feature.

### Core network settings

**`ARC_RPC_URL`** is the **server-side** RPC URL—used by API routes, scripts and anything that runs in Node and must query Arc without going through the browser’s default. **`VITE_ARC_RPC_URL`** is an **optional browser override** when you want the client bundle to use a different endpoint than the server (for example, a dedicated provider key in the browser while the server uses another). **`ARC_CHAIN_ID`** pins the chain ID the tooling assumes; it **defaults to `5042002`**, which is the Arc testnet identifier you should see reflected in the app’s chain indicator once RPC and wallet line up.

### Privacy pool settings

PrivPay’s privacy pool and client proving pipeline read several **`VITE_`-prefixed** addresses and artifact locations so the browser can resolve the right contracts and Groth16 assets. Set **`VITE_PRIVACY_POOL_ADDRESS_USDC`**, **`VITE_PRIVACY_POOL_ADDRESS_EURC`** and **`VITE_PRIVACY_POOL_ADDRESS_SWPRC`** to the on-chain pool deployment for each supported token, matching whatever you deployed or were given for your environment. **`VITE_PRIVACY_POOL_FROM_BLOCK`** should be the first block where the pool contract exists so indexers and log scans stay efficient on Arc (narrow ranges matter where **getLogs** windows are capped). **`VITE_PRIVPAY_WASM_URL`** and **`VITE_PRIVPAY_ZKEY_URL`** point at the **WASM** and **final zkey** the browser loads for Groth16 proving in the claim flow; typically under `public/` or a CDN URL you control. Until these are coherent with your deployment, claim and pool UIs will misbehave in ways that look like “loading forever” or proof errors rather than ordinary swap failures.

### Relayer settings (if using relay)

When the app posts deposits or withdrawals through the relay instead of only user-signed paths, enable and fund **`VITE_PRIVACY_POOL_USE_RELAY`** according to your deployment’s expectations and supply **`PRIVACY_POOL_RELAYER_PRIVATE_KEY`** for the relayer wallet that signs relayed actions (never reuse a personal hot wallet for this in shared environments). **`PRIVPAY_ALLOWED_POOL_ADDRESSES`** restricts which pool contract addresses the relay will accept; if you omit the aggregate list, configure the **per-token pool variables** referenced in `.env.example` so server jobs and relay code agree on the same three pools. Rate and deadline knobs matter for abuse resistance and UX: set **`PRIVPAY_RELAY_RPM`** to cap requests per minute from clients, and **`PRIVPAY_RELAY_MAX_DEADLINE_SEC`** so submitted deadlines cannot be arbitrarily far in the future.

Optional controls fine-tune how the relay authenticates and rate-limits in hosted setups. **`PRIVPAY_RELAY_SERVER_SECRET`** is the shared secret clients must present when your deployment requires it on relay routes. **`PRIVPAY_RELAY_RL_PEPPER`** seeds relay rate-limiting so distinct deployments do not share predictable bucket keys. **`PRIVPAY_RELAY_REQUIRE_KV`** (for example set to **`1`** on Vercel when you rely on KV for relay limits) forces the stricter path where in-memory fallback is unacceptable when KV errors; consult [Relayer operations](../operate/relayer-operations.md) alongside the API reference when enabling this.

### Swap pool (V2)

The **Swap** tab uses the UUPS proxy at **`VITE_SWAP_POOL_ADDRESS`** (browser) and **`SWAP_POOL_ADDRESS`** (server/indexer). Both default to the canonical V2 proxy in code if unset. Tokens: **USDC**, **EURC**, **SWPRC**, **CircBTC**. See [Jobs & health checks](../operate/jobs-and-healthchecks.md) for the Railway swap indexer.

### Circle settings (for email wallet mode)

Email wallet mode splits credentials the way Vite intends: **`VITE_CIRCLE_APP_ID`** is the **client-visible** Circle application identifier bundled into the frontend. **`CIRCLE_API_KEY`** stays **server-side** for routes that call Circle’s APIs without exposing keys to the browser. **`CIRCLE_BASE_URL`** is **optional** and **defaults to Circle’s API base URL** when unset; override only when you are pointed at a documented Circle host or a proxy you fully control.

## Run the app

```bash
npm run dev
```

Start the dev server, open the app in your browser and treat the first load as a smoke test. Confirm **the chain indicator matches Arc testnet** so you are not accidentally on mainnet or a stale custom network. Check that **tokens and balances load** for the configured assets—if RPC or pool env vars are wrong, the UI often degrades before you hit a transaction. Finally, ensure **wallet connection options are visible** so both standard and Circle paths match what you expect to support in this environment.

## Warning

Do not run production relayer keys in local development.
Use dedicated test keys and test pool addresses.
