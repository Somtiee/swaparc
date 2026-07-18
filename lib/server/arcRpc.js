import { ethers } from "ethers";

const ARC_PUBLIC_RPC = "https://rpc.testnet.arc.network";
const ARC_FREE_FALLBACK_RPC = "https://arc-testnet.drpc.org";
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);

/** Skip public RPC for a while after rate-limit so recurring doesn't keep slamming it. */
const publicCooldown =
  globalThis.__swaparcPublicRpcCooldown ||
  (globalThis.__swaparcPublicRpcCooldown = { until: 0 });

/**
 * True when an RPC error is quota/network flakiness (safe to try the next URL).
 * Does NOT treat normal contract reverts as retryable.
 */
export function isTransientRpcError(err) {
  const msg = String(err?.message || err?.shortMessage || err || "");
  const code = err?.error?.code ?? err?.code ?? err?.info?.error?.code;
  if (code === -32011 || code === 429) return true;
  return /request limit reached|rate limit|too many requests|\b429\b|could not coalesce|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|missing revert data|network error|failed to detect network|timed out|timeout/i.test(
    msg
  );
}

function isRateLimitError(err) {
  const msg = String(err?.message || err?.shortMessage || err || "");
  const code = err?.error?.code ?? err?.code ?? err?.info?.error?.code;
  return code === -32011 || code === 429 || /request limit reached|rate limit|too many requests/i.test(msg);
}

/**
 * Ordered RPCs for Arc testnet (Swap / Pools / PrivPay / Profile / recurring):
 * 1) public Arc RPC
 * 2) free dRPC
 * 3) Alchemy LAST (only when both free endpoints fail — protects free-tier credits)
 *
 * If public was recently rate-limited, it is skipped for ~3 minutes so autopay
 * can keep working on dRPC without burning Alchemy credits.
 */
export function getArcRpcUrls() {
  const urls = [];
  const now = Date.now();
  if (now >= Number(publicCooldown.until || 0)) {
    urls.push(ARC_PUBLIC_RPC);
  }
  urls.push(ARC_FREE_FALLBACK_RPC);
  const alchemy = String(
    process.env.ALCHEMY_ARC_RPC_URL ||
      process.env.VITE_ALCHEMY_ARC_RPC_URL ||
      ""
  ).trim();
  if (alchemy && !urls.includes(alchemy)) urls.push(alchemy);
  return [...new Set(urls.filter(Boolean))];
}

export function createArcJsonRpcProvider(url) {
  const network = ethers.Network.from({
    chainId: ARC_CHAIN_ID,
    name: "arc-testnet",
  });
  return new ethers.JsonRpcProvider(url, network, {
    batchMaxCount: 1,
    staticNetwork: network,
  });
}

/**
 * Run `fn(provider, url)` against each RPC until one succeeds.
 * Alchemy is last in the list, so it is only hit after public/dRPC fail.
 */
export async function withArcRpc(fn, label = "rpc", perAttemptMs = 6000) {
  const urls = getArcRpcUrls();
  let lastErr = null;
  for (const url of urls) {
    let timer;
    const attemptMs =
      url === ARC_PUBLIC_RPC ? Math.min(perAttemptMs, 2500) : perAttemptMs;
    try {
      const provider = createArcJsonRpcProvider(url);
      const result = await Promise.race([
        fn(provider, url),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out on ${url}`)),
            attemptMs
          );
        }),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
      if (url === ARC_PUBLIC_RPC && isRateLimitError(err)) {
        publicCooldown.until = Date.now() + 3 * 60 * 1000;
        console.warn(
          `[arcRpc] public RPC rate-limited — skipping it for 3 minutes; using dRPC/Alchemy`
        );
      }
      if (!isTransientRpcError(err)) throw err;
      console.warn(
        `[arcRpc] ${label} failed on ${url}: ${String(err?.message || err).slice(0, 160)}`
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw (
    lastErr ||
    new Error(`${label} failed on all Arc RPCs`)
  );
}

/** Provider bound to the first healthy RPC (probes blockNumber, not eth_chainId). */
export async function getHealthyArcProvider(label = "provider") {
  return withArcRpc(async (provider, url) => {
    await provider.getBlockNumber();
    console.log(`[arcRpc] ${label} bound to ${url}`);
    return provider;
  }, label, 6000);
}
