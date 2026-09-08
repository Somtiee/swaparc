import { ethers } from "ethers";

/**
 * Single home for ALL Arc read-RPC plumbing.
 *
 * Design rules (learned from the 2026-09 outage — do not regress):
 *  1. dRPC comes FIRST. The public Arc RPC (rpc.testnet.arc.network) is
 *     healthy from server IPs but rate-limits BROWSERS per-IP with 429 —
 *     putting it first meant every fresh page load ate a failed round-trip
 *     before failover kicked in.
 *  2. Every provider has a hard request timeout (FetchRequest). Without it,
 *     a connection that hangs without erroring blocks the await for the
 *     browser's default fetch timeout — minutes — which is what made
 *     transactions "hang" before the signature popup appeared.
 *  3. Failover rotates ONLY on transport/rate-limit errors. Genuine
 *     JSON-RPC responses (reverts, "missing revert data") must surface
 *     unchanged.
 *  4. Alchemy (paid) is strictly last-resort, and only when
 *     VITE_ALCHEMY_ARC_RPC_URL is set.
 */

export const ARC_PUBLIC_RPC = "https://rpc.testnet.arc.network";
export const ARC_DRPC_RPC = "https://arc-testnet.drpc.org";

export const ARC_CHAIN_ID_DEC = (() => {
  const n = Number(import.meta.env.VITE_ARC_CHAIN_ID || "");
  return Number.isFinite(n) && n > 0 ? n : 5042002;
})();

const ALCHEMY_RPC_URL = String(
  import.meta.env.VITE_ALCHEMY_ARC_RPC_URL || ""
).trim();

/** Read order: dRPC → public → Alchemy. */
export const ARC_READ_RPC_URLS = [
  ARC_DRPC_RPC,
  ARC_PUBLIC_RPC,
  ...(ALCHEMY_RPC_URL && ALCHEMY_RPC_URL !== ARC_DRPC_RPC
    ? [ALCHEMY_RPC_URL]
    : []),
];

/** Hard per-request timeout for every Arc read. */
const REQUEST_TIMEOUT_MS = 3500;

const ARC_NETWORK = { chainId: ARC_CHAIN_ID_DEC, name: "arc-testnet" };
const PROVIDER_OPTS = { batchMaxCount: 1, staticNetwork: true };

/** Cached per-URL providers so connections are reused across calls. */
const providerCache = new Map();

export function getReadProviderForUrl(url) {
  let provider = providerCache.get(url);
  if (!provider) {
    const fetchRequest = new ethers.FetchRequest(url);
    fetchRequest.timeout = REQUEST_TIMEOUT_MS;
    provider = new ethers.JsonRpcProvider(
      fetchRequest,
      ARC_NETWORK,
      PROVIDER_OPTS
    );
    providerCache.set(url, provider);
  }
  return provider;
}

const RETRYABLE_RPC_ERROR =
  /rate limit|request limit|429|-32005|-32011|-32012|too many requests|timeout|timed out|network error|fetch failed|ECONN|socket hang up|ENOTFOUND|EAI_AGAIN|service unavailable|503|502/i;

export function isRetryableRpcError(err) {
  return RETRYABLE_RPC_ERROR.test(String(err?.message || err || ""));
}

/**
 * Auto-failover JSON-RPC provider: every request goes to the last healthy
 * URL; on a rate-limit / transport error it rotates to the next URL and
 * remembers the winner. Everything that only needs reads should use
 * getReadProvider(); nothing should pin to one URL.
 */
let readProviderSingleton = null;

export function getReadProvider() {
  if (readProviderSingleton) return readProviderSingleton;
  const urls = ARC_READ_RPC_URLS.length ? ARC_READ_RPC_URLS : [ARC_PUBLIC_RPC];
  const children = urls.map((url) => getReadProviderForUrl(url));
  let active = 0;

  class ArcFailoverProvider extends ethers.JsonRpcProvider {
    constructor() {
      const fetchRequest = new ethers.FetchRequest(urls[0]);
      fetchRequest.timeout = REQUEST_TIMEOUT_MS;
      super(fetchRequest, ARC_NETWORK, PROVIDER_OPTS);
    }

    async send(method, params) {
      const order = urls.map((_, i) => (active + i) % urls.length);
      let lastErr = null;
      for (const idx of order) {
        try {
          const result =
            idx === 0
              ? await super.send(method, params)
              : await children[idx].send(method, params);
          if (idx !== active) {
            active = idx;
            console.warn(
              `[RPC] ${method}: switched to ${new URL(urls[idx]).host} after failure`
            );
          }
          return result;
        } catch (err) {
          lastErr = err;
          if (!isRetryableRpcError(err)) throw err;
        }
      }
      throw lastErr || new Error(`${method} failed on all RPCs`);
    }
  }

  readProviderSingleton = new ArcFailoverProvider();
  return readProviderSingleton;
}

export function withTimeout(promise, ms = 4000, label = "rpc") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Sequential best-effort read across all RPCs (each capped by a timeout). */
export async function withReadProviders(fn, label = "read") {
  let lastErr = null;
  for (const url of ARC_READ_RPC_URLS) {
    try {
      return await withTimeout(fn(getReadProviderForUrl(url), url), 4000, label);
    } catch (e) {
      lastErr = e;
      console.warn(`[RPC] ${label} failed on ${url}`, e?.message || e);
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

/**
 * Read with automatic fallback: races ALL free RPCs in parallel (first
 * healthy answer wins — no waiting on a rate-limited endpoint), then tries
 * Alchemy strictly last. Use this for one-shot reads on the hot path.
 */
export async function ethCallWithRpcFallback(fn, label = "read") {
  let lastErr = null;
  const freeUrls = ARC_READ_RPC_URLS.filter((u) => u && u !== ALCHEMY_RPC_URL);
  const paidUrls = ALCHEMY_RPC_URL ? [ALCHEMY_RPC_URL] : [];

  if (freeUrls.length > 0) {
    try {
      const { result } = await Promise.any(
        freeUrls.map(async (url) => ({
          result: await withTimeout(
            fn(getReadProviderForUrl(url), url),
            // The public RPC 429s browsers quickly when it 429s at all;
            // give it a shorter leash so dRPC usually wins the race anyway.
            url === ARC_PUBLIC_RPC ? 2500 : 4500,
            label
          ),
        }))
      );
      return result;
    } catch (agg) {
      const errs = agg?.errors || [];
      lastErr = errs[errs.length - 1] || agg;
      console.warn(
        `[RPC] ${label} failed on free RPCs${paidUrls.length ? ", trying Alchemy" : ""}:`,
        String(lastErr?.message || lastErr).slice(0, 120)
      );
    }
  }

  for (const url of paidUrls) {
    try {
      return await withTimeout(
        fn(getReadProviderForUrl(url), url),
        6000,
        label
      );
    } catch (e) {
      lastErr = e;
      console.warn(
        `[RPC] ${label} failed on Alchemy:`,
        String(e?.message || e).slice(0, 120)
      );
    }
  }

  throw lastErr || new Error(`${label} failed`);
}
