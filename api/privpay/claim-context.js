import { ethers } from "ethers";
import { kv } from "../../lib/server/kv.js";
import { PrivacyPoolPoseidonMerkleMirror } from "../../scripts/privacyPoolPoseidonMerkle.mjs";
import { assertIpRateLimit } from "../security/walletAuth.js";
import { assertRelayPoolAllowed, getRelayAllowedPoolSet } from "../../lib/server/privpayRelayCore.js";

const DEPOSITED_IFACE = new ethers.Interface([
  "event Deposited(bytes32 indexed commitment, uint256 amount)",
]);
const DEPOSITED_TOPIC = ethers.id("Deposited(bytes32,uint256)");
const POOL_IFACE = new ethers.Interface([
  "function isKnownRoot(bytes32) view returns (bool)",
  "function nextIndex() view returns (uint32)",
  "function currentRoot() view returns (bytes32)",
]);

const DEFAULT_WINDOWS = [9999, 4000, 1000, 250];
/**
 * One request must stay well under the ~30s proxy/gateway limit in front of
 * the API, so scanning is bounded by a wall-clock deadline (the chunk cap is
 * only a secondary guard — healthy requests scan as many chunks as the
 * deadline allows); partial progress is persisted and the next poll
 * continues.
 */
const MAX_CHUNKS_PER_REQUEST = Math.max(
  1,
  Math.min(2000, Number(process.env.PRIVPAY_CLAIM_CONTEXT_CHUNKS || 400))
);
const SCAN_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.PRIVPAY_CLAIM_CONTEXT_CONCURRENCY || 8))
);
const REQUEST_DEADLINE_MS = Math.max(
  5000,
  Math.min(25000, Number(process.env.PRIVPAY_CLAIM_CONTEXT_DEADLINE_MS || 15000))
);
/**
 * Per-RPC-call timeout — WITHOUT an explicit race, ethers' internal retry
 * keeps a throttled call pending for 20s+ and one stalled endpoint hangs the
 * whole scan (observed in production).
 */
const RPC_TIMEOUT_MS = Math.max(
  2000,
  Math.min(60000, Number(process.env.PRIVPAY_CLAIM_CONTEXT_RPC_TIMEOUT_MS || 8000))
);

/** Snapshot TTL — long enough that a full 20M-block rescan is rare. */
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Hard-cap any promise; ethers' built-in retry can outlive FetchRequest.timeout. */
function withTimeout(promise, ms, label = "rpc") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function parseFromBlock(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function providerUrls() {
  // Operator/test override: pin the exact RPC list (comma-separated).
  const override = String(process.env.PRIVPAY_CLAIM_CONTEXT_RPC_URLS || "").trim();
  if (override) {
    return [...new Set(override.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  const out = [];
  const alchemy = String(process.env.VITE_ALCHEMY_ARC_RPC_URL || "").trim();
  if (alchemy) out.push(alchemy);
  out.push("https://arc-testnet.drpc.org");
  const arc = String(process.env.ARC_RPC_URL || "").trim();
  if (arc) out.push(arc);
  const viteArc = String(process.env.VITE_ARC_RPC_URL || "").trim();
  if (viteArc) out.push(viteArc);
  out.push("https://rpc.testnet.arc.network");
  return [...new Set(out)];
}

/**
 * Alchemy's free tier rejects eth_getLogs ranges over 10 blocks, so it can
 * never serve a scan window — worse, its throttled responses become the
 * straggler every parallel batch waits on. Keep it for cheap state reads
 * (nextIndex/currentRoot/blockNumber) but never for log scanning.
 */
function scanProviderUrls() {
  return providerUrls().filter(
    (url) => !/alchemy/i.test(String(url))
  );
}

function makeProvider(url) {
  const request = new ethers.FetchRequest(url);
  request.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
}

function getProviders(urls) {
  return urls.map((url) => ({ url, provider: makeProvider(url) }));
}

function logKey(log) {
  return `${String(log.blockNumber || "")}:${String(log.transactionHash || "")}:${String(log.logIndex || "")}`;
}

/**
 * How long a kicked background warmer keeps scanning after a pending response.
 * The API container is long-lived (VPS docker), so continuing the scan between
 * the client's polls turns a cold-cache claim from dozens of polls into ~1-2.
 */
const WARM_BUDGET_MS = Math.max(
  30000,
  Math.min(600000, Number(process.env.PRIVPAY_CLAIM_CONTEXT_WARM_MS || 180000))
);
/**
 * Warmer iterations run in small bites so a concurrent user request never
 * queues behind a long lock hold (worst lock wait ≈ one iteration).
 */
const WARM_ITERATION_MS = Math.max(
  2000,
  Math.min(10000, Math.round(REQUEST_DEADLINE_MS / 3))
);

/**
 * Per-pool scan mutex. Two concurrent scans on the same snapshot would
 * interleave writes and lose/reorder deposits (leafIndex depends on order), so
 * every scan — user request or background warmer — serializes through here.
 * `lockHeld` lets user requests SKIP instead of queueing behind a warmer bite
 * (a queued poll could exceed the proxy window even with a bounded scan).
 */
const scanLocks = new Map();
const lockDepth = new Map();
function withScanLock(key, fn) {
  lockDepth.set(key, (lockDepth.get(key) || 0) + 1);
  const prev = scanLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  scanLocks.set(
    key,
    run.then(
      () => {},
      () => {}
    ).finally(() => {
      const d = (lockDepth.get(key) || 1) - 1;
      if (d <= 0) lockDepth.delete(key);
      else lockDepth.set(key, d);
    })
  );
  return run;
}
const lockHeld = (key) => (lockDepth.get(key) || 0) > 0;

function snapshotKeyFor(poolAddress, merkleHeight, fromBlock) {
  return `privpay:pool:index:v4:${poolAddress.toLowerCase()}:${merkleHeight}:${fromBlock}`;
}

function sortLogs(logs) {
  return logs.sort((a, b) => {
    const ba = Number(a.blockNumber || 0);
    const bb = Number(b.blockNumber || 0);
    if (ba !== bb) return ba - bb;
    return Number(a.logIndex || 0) - Number(b.logIndex || 0);
  });
}

/**
 * First successful provider response wins. Waiting for ALL providers
 * (allSettled) meant one throttled endpoint made every window burn its full
 * timeout even when a healthy RPC answered in ~300ms — that single straggler
 * cut scan throughput ~10x in production. A provider returning an incomplete
 * result is caught later by the count-mismatch ladder + on-chain root check.
 */
async function getLogsUnion(providers, params) {
  try {
    const logs = await Promise.any(
      providers.map(({ provider }) =>
        withTimeout(provider.getLogs(params), RPC_TIMEOUT_MS, "getLogs")
      )
    );
    return sortLogs(Array.isArray(logs) ? logs : []);
  } catch {
    throw new Error("All RPC providers failed for getLogs window.");
  }
}

async function getLatestBlock(providers) {
  try {
    const n = await Promise.any(
      providers.map(({ provider }) =>
        withTimeout(provider.getBlockNumber(), RPC_TIMEOUT_MS, "blockNumber")
      )
    );
    if (!Number.isFinite(Number(n))) throw new Error("bad blockNumber");
    return Number(n);
  } catch {
    throw new Error("Failed to fetch latest block from providers.");
  }
}

async function getOnchainState(providers, poolAddress) {
  try {
    return await Promise.any(
      providers.map(async ({ provider }) => {
        const contract = new ethers.Contract(poolAddress, POOL_IFACE, provider);
        const [nextIndex, currentRoot] = await Promise.all([
          withTimeout(contract.nextIndex(), RPC_TIMEOUT_MS, "nextIndex"),
          withTimeout(contract.currentRoot(), RPC_TIMEOUT_MS, "currentRoot"),
        ]);
        return {
          nextIndex: Number(nextIndex),
          currentRoot: ethers.hexlify(currentRoot),
        };
      })
    );
  } catch {
    throw new Error("Failed to read on-chain nextIndex/currentRoot from any provider.");
  }
}

async function isKnownRootMulti(providers, poolAddress, root) {
  try {
    return await Promise.any(
      providers.map(async ({ provider }) => {
        const contract = new ethers.Contract(poolAddress, POOL_IFACE, provider);
        const known = await withTimeout(
          contract.isKnownRoot(root),
          RPC_TIMEOUT_MS,
          "isKnownRoot"
        );
        if (!known) throw new Error("root unknown at provider");
        return true;
      })
    );
  } catch {
    return false;
  }
}

function bytesEqHex(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

async function scanRangeUnion(providers, poolAddress, fromBlock, toBlock, window, deadlineMs = 0) {
  const ranges = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += window) {
    ranges.push([cursor, Math.min(cursor + window - 1, toBlock)]);
  }
  const seen = new Map();
  for (let i = 0; i < ranges.length; i += SCAN_CONCURRENCY) {
    if (deadlineMs && Date.now() > deadlineMs) break;
    const batch = ranges.slice(i, i + SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map(([fromB, toB]) =>
        getLogsUnion(providers, {
          address: poolAddress,
          fromBlock: fromB,
          toBlock: toB,
          topics: [DEPOSITED_TOPIC],
        }).catch(() => [])
      )
    );
    for (const logs of results) {
      for (const log of logs) seen.set(logKey(log), log);
    }
  }
  return sortLogs(Array.from(seen.values()));
}

function commitmentsFromLogs(logs) {
  return logs.map((log) => {
    const parsed = DEPOSITED_IFACE.parseLog(log);
    return ethers.zeroPadValue(parsed.args.commitment, 32).toLowerCase();
  });
}

async function computeProof(commitments, merkleHeight, leafIndex) {
  const mirror = await PrivacyPoolPoseidonMerkleMirror.create(merkleHeight);
  for (const c of commitments.slice(0, leafIndex + 1)) {
    await mirror.insert(ethers.getBytes(c));
  }
  return mirror.getMerkleProof(leafIndex, leafIndex + 1);
}

const STATE_CACHE_MS = 20000;

/**
 * One bounded scan step: read on-chain state, continue the incremental scan up
 * to `budgetMs`, persist the snapshot, and report whether the canonical
 * history is complete+validated. Shared by the request path (short budget)
 * and the background warmer (small repeated bites, state cached between
 * bites and force-refreshed before the final validation).
 */
async function advanceSnapshot({
  providers,
  scanProviders,
  poolAddress,
  merkleHeight,
  fromBlock,
  budgetMs,
  stateCache = null,
}) {
  const snapshotKey = snapshotKeyFor(poolAddress, merkleHeight, fromBlock);
  const deadline = Date.now() + budgetMs;

  const snap = (await kv.get(snapshotKey).catch(() => null)) || {};
  let commitments = Array.isArray(snap?.commitments) ? snap.commitments.slice() : [];
  let lastScannedBlock = Number.isFinite(Number(snap?.lastScannedBlock))
    ? Number(snap.lastScannedBlock)
    : fromBlock - 1;
  const cachedValidated = Boolean(snap?.validated);

  let onchain = null;
  let latest = null;
  if (
    stateCache &&
    stateCache.onchain &&
    stateCache.latest != null &&
    Date.now() - (stateCache.at || 0) < STATE_CACHE_MS
  ) {
    onchain = stateCache.onchain;
    latest = stateCache.latest;
  } else {
    onchain = await getOnchainState(providers, poolAddress);
    latest = await getLatestBlock(providers);
    if (stateCache) {
      stateCache.onchain = onchain;
      stateCache.latest = latest;
      stateCache.at = Date.now();
    }
  }

  // If cache is valid & complete for current nextIndex, use it.
  if (
    cachedValidated &&
    commitments.length === onchain.nextIndex &&
    lastScannedBlock >= latest - 1
  ) {
    return { complete: true, commitments, lastScannedBlock, onchain, latest };
  }

  // INCREMENTAL + PARALLEL scan: continue from cached lastScannedBlock + 1.
  // Build a list of chunk ranges [from, to] up to MAX_CHUNKS_PER_REQUEST,
  // then fetch them concurrently in batches of SCAN_CONCURRENCY.
  const startCursor = Math.max(fromBlock, Number(lastScannedBlock) + 1);
  const window = DEFAULT_WINDOWS[0];
  const ranges = [];
  for (
    let c = startCursor;
    c <= latest && ranges.length < MAX_CHUNKS_PER_REQUEST;
    c += window
  ) {
    ranges.push([c, Math.min(c + window - 1, latest)]);
  }

  const seenLogKeys = new Set();
  const seenCommitments = new Set(commitments);
  let hadRangeFailure = false;

  for (let i = 0; i < ranges.length; i += SCAN_CONCURRENCY) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 500) break;
    const batch = ranges.slice(i, i + SCAN_CONCURRENCY);
    // Cap the wave by the remaining budget so this step always returns well
    // inside the proxy window, even when providers stall (raced calls keep
    // running but their results are discarded).
    const results = await withTimeout(
      Promise.all(
        batch.map(([fromB, toB]) =>
          getLogsUnion(scanProviders, {
            address: poolAddress,
            fromBlock: fromB,
            toBlock: toB,
            topics: [DEPOSITED_TOPIC],
          })
            .then((logs) => ({ ok: true, logs, fromB, toB }))
            .catch(() => ({ ok: false, fromB, toB }))
        )
      ),
      remainingMs,
      "scan-wave"
    ).catch(() => null);
    if (!results) {
      // Wave exceeded the budget — persist progress and let the next step
      // (next poll or warmer iteration) retry these ranges.
      hadRangeFailure = true;
      break;
    }
    // Process in order so leafIndex stays correct across batches.
    for (const r of results) {
      if (!r.ok) {
        hadRangeFailure = true;
        break;
      }
      for (const log of r.logs) {
        const k = logKey(log);
        if (seenLogKeys.has(k)) continue;
        seenLogKeys.add(k);
        const parsed = DEPOSITED_IFACE.parseLog(log);
        const c = ethers.zeroPadValue(parsed.args.commitment, 32).toLowerCase();
        if (!seenCommitments.has(c)) {
          seenCommitments.add(c);
          commitments.push(c);
        }
      }
      lastScannedBlock = r.toB;
    }
    if (hadRangeFailure) break;
  }

  const scannedChunks = ranges.length;
  const reachedLatest = lastScannedBlock >= latest;

  if (!reachedLatest) {
    // Persist partial progress so the NEXT step continues, not restarts.
    await kv
      .set(
        snapshotKey,
        {
          commitments,
          lastScannedBlock,
          updatedAt: new Date().toISOString(),
          validated: false,
          // Stored so a poll that skips the scan (lock held by the warmer)
          // can report progress without any RPC calls.
          expectedDeposits: onchain.nextIndex,
          latestBlock: latest,
        },
        { ex: SNAPSHOT_TTL_SECONDS }
      )
      .catch(() => {});
    return {
      pending: true,
      progress: {
        scannedToBlock: lastScannedBlock,
        latestBlock: latest,
        chunksThisRequest: scannedChunks,
        knownDeposits: commitments.length,
        expectedDeposits: onchain.nextIndex,
      },
    };
  }

  // Reached latest — force-refresh state before the final count/root check so
  // a warmer's cached nextIndex (up to STATE_CACHE_MS old) can't validate
  // against a stale view of the pool.
  if (stateCache) {
    stateCache.onchain = null;
    stateCache.latest = null;
    stateCache.at = 0;
  }
  onchain = await getOnchainState(providers, poolAddress);
  latest = await getLatestBlock(providers);
  if (stateCache) {
    stateCache.onchain = onchain;
    stateCache.latest = latest;
    stateCache.at = Date.now();
  }

  // Reached latest. If count still doesn't match nextIndex, do a full
  // rebuild with progressively narrower windows (providers missed logs).
  if (commitments.length !== onchain.nextIndex) {
    for (const retryWindow of DEFAULT_WINDOWS.slice(1).concat([100])) {
      if (Date.now() > deadline) break;
      const logs = await scanRangeUnion(
        scanProviders,
        poolAddress,
        fromBlock,
        latest,
        retryWindow,
        deadline
      );
      if (logs.length >= onchain.nextIndex) {
        commitments = commitmentsFromLogs(logs);
        break;
      }
    }
  }

  if (commitments.length !== onchain.nextIndex) {
    // Final safety: building a proof against an incomplete tree is impossible.
    // Invalidate the cache by NOT marking validated.
    await kv
      .set(
        snapshotKey,
        {
          commitments,
          lastScannedBlock,
          updatedAt: new Date().toISOString(),
          validated: false,
        },
        { ex: SNAPSHOT_TTL_SECONDS }
      )
      .catch(() => {});
    return {
      error: `Pool history incomplete from RPC providers. Expected ${onchain.nextIndex} deposits, got ${commitments.length}. Please retry in a few seconds.`,
      status: 503,
    };
  }

  // Count matches — verify by computing root of full tree and comparing to currentRoot.
  const fullMirror = await PrivacyPoolPoseidonMerkleMirror.create(merkleHeight);
  for (const c of commitments) {
    await fullMirror.insert(ethers.getBytes(c));
  }
  const fullRoot = ethers.hexlify(
    (await fullMirror.getMerkleProof(0, commitments.length)).root
  );
  const matchesCurrent = bytesEqHex(fullRoot, onchain.currentRoot);

  await kv
    .set(
      snapshotKey,
      {
        commitments,
        lastScannedBlock,
        updatedAt: new Date().toISOString(),
        validated: matchesCurrent,
      },
      { ex: SNAPSHOT_TTL_SECONDS }
    )
    .catch(() => {});

  if (!matchesCurrent) {
    return {
      error:
        "Pool history did not match on-chain root after full scan. Providers may be temporarily out of sync. Please retry shortly.",
      status: 503,
    };
  }

  return { complete: true, commitments, lastScannedBlock, onchain, latest };
}

const warmingPools = new Set();

/**
 * Fire-and-forget continuation: after a pending response, keep scanning in
 * small lock-bounded bites until the snapshot is complete (or the budget
 * runs out). The client's next poll then finds a validated cache and gets
 * its proof context immediately. On-chain state is cached between bites and
 * force-refreshed before the final validation (inside advanceSnapshot).
 */
function kickSnapshotWarmer(ctx) {
  const key = `${ctx.poolAddress.toLowerCase()}:${ctx.merkleHeight}:${ctx.fromBlock}`;
  if (warmingPools.has(key)) return;
  warmingPools.add(key);
  const startedAt = Date.now();
  const stateCache = { onchain: null, latest: null, at: 0 };
  (async () => {
    while (Date.now() - startedAt < WARM_BUDGET_MS) {
      const remaining = WARM_BUDGET_MS - (Date.now() - startedAt);
      let step;
      try {
        step = await withScanLock(key, () =>
          advanceSnapshot({
            ...ctx,
            budgetMs: Math.min(WARM_ITERATION_MS, remaining),
            stateCache,
          })
        );
      } catch {
        return; // RPC-level failure — user polls will retry the scan
      }
      if (!step || step.complete || step.error) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  })()
    .catch(() => {})
    .finally(() => warmingPools.delete(key));
}

/**
 * Keep-warm hook for the recurring/payroll run endpoints (which the cron hits
 * every 5 min and the open app ticks every ~15s). Kicks the background warmer
 * for every allowlisted pool at most once a minute, so pool snapshots stay
 * complete+validated and user claims never trigger a cold 20M-block scan.
 * Fire-and-forget: never blocks or fails the caller.
 */
const globalWarmState =
  globalThis.__privpayPoolWarmState || (globalThis.__privpayPoolWarmState = { at: 0 });
export async function warmPrivacyPoolSnapshots() {
  try {
    if (Date.now() - globalWarmState.at < 60000) return;
    globalWarmState.at = Date.now();
    const merkleHeight = 16;
    const envFromBlock =
      process.env.PRIVPAY_POOL_FROM_BLOCK ||
      process.env.VITE_PRIVACY_POOL_FROM_BLOCK ||
      process.env.PRIVACY_POOL_FROM_BLOCK ||
      "0";
    const fromBlock = parseFromBlock(envFromBlock);
    const pools = Array.from(getRelayAllowedPoolSet());
    if (!pools.length) return;
    const providers = getProviders(providerUrls());
    const scanProviders = getProviders(scanProviderUrls());
    for (const pool of pools) {
      let poolAddress;
      try {
        poolAddress = ethers.getAddress(pool);
      } catch {
        continue;
      }
      kickSnapshotWarmer({
        providers,
        scanProviders,
        poolAddress,
        merkleHeight,
        fromBlock,
      });
    }
  } catch {
    /* never throw from a warm kick */
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    await assertIpRateLimit(req, "privpay-claim-context", 30);
    const poolAddress = ethers.getAddress(String(req.query?.poolAddress || ""));
    // Only known pools may drive server-side scans — an arbitrary address turns
    // this endpoint into an RPC-billing / Redis-growth amplifier.
    assertRelayPoolAllowed(poolAddress);
    const commitment = ethers.zeroPadValue(String(req.query?.commitment || ""), 32);
    const merkleHeight = Math.max(16, Math.min(32, Number(req.query?.merkleHeight || 16)));
    // fromBlock is server-configured only. A client-supplied fromBlock would let
    // anyone mint unbounded distinct Redis snapshot keys.
    const envFromBlock =
      process.env.PRIVPAY_POOL_FROM_BLOCK ||
      process.env.VITE_PRIVACY_POOL_FROM_BLOCK ||
      process.env.PRIVACY_POOL_FROM_BLOCK ||
      "0";
    const fromBlock = parseFromBlock(envFromBlock);
    const lockKey = `${poolAddress.toLowerCase()}:${merkleHeight}:${fromBlock}`;

    const providers = getProviders(providerUrls());
    const scanProviders = getProviders(scanProviderUrls());

    let advanced;
    if (lockHeld(lockKey)) {
      // A background warmer (or another poll) is mid-scan: report the stored
      // progress instantly instead of queueing behind the lock — a queued poll
      // could blow the proxy window even with a deadline-bounded scan.
      const snap =
        (await kv
          .get(snapshotKeyFor(poolAddress, merkleHeight, fromBlock))
          .catch(() => null)) || {};
      if (!snap?.validated) {
        return res.status(202).json({
          ok: false,
          pending: true,
          progress: {
            scannedToBlock: Number(snap?.lastScannedBlock ?? fromBlock - 1),
            latestBlock: Number(snap?.latestBlock ?? 0),
            knownDeposits: Array.isArray(snap?.commitments) ? snap.commitments.length : 0,
            expectedDeposits: Number(snap?.expectedDeposits ?? 0),
          },
        });
      }
      // Snapshot is validated — fall through and serve the proof from it.
      advanced = {
        complete: true,
        commitments: snap.commitments.slice(),
        lastScannedBlock: Number(snap.lastScannedBlock || fromBlock),
      };
    } else {
      advanced = await withScanLock(lockKey, () =>
        advanceSnapshot({
          providers,
          scanProviders,
          poolAddress,
          merkleHeight,
          fromBlock,
          budgetMs: REQUEST_DEADLINE_MS,
        })
      );

      if (advanced.pending) {
        // Scan is incomplete — respond fast with progress and keep warming
        // server-side between the client's polls.
        kickSnapshotWarmer({
          providers,
          scanProviders,
          poolAddress,
          merkleHeight,
          fromBlock,
        });
        return res
          .status(202)
          .json({ ok: false, pending: true, progress: advanced.progress });
      }
    }
    if (advanced.error) {
      return res.status(advanced.status || 503).json({ ok: false, error: advanced.error });
    }

    const { commitments, lastScannedBlock } = advanced;
    const leafIndex = commitments.findIndex((c) => bytesEqHex(c, commitment));
    if (leafIndex < 0) {
      return res.status(404).json({
        ok: false,
        error:
          "Commitment not found in canonical pool history. Check claim code recipient/pool/token.",
      });
    }

    const proof = await computeProof(commitments, merkleHeight, leafIndex);
    const root = ethers.hexlify(proof.root);

    // Sanity: verify the historical root is known on-chain.
    const known = await isKnownRootMulti(providers, poolAddress, root);
    if (!known) {
      // Cache might be stale (e.g. after a fresh deposit in between); invalidate and ask client to retry.
      await kv
        .set(
          snapshotKeyFor(poolAddress, merkleHeight, fromBlock),
          {
            commitments,
            lastScannedBlock,
            updatedAt: new Date().toISOString(),
            validated: false,
          },
          { ex: SNAPSHOT_TTL_SECONDS }
        )
        .catch(() => {});
      return res.status(503).json({
        ok: false,
        error:
          "Computed claim root not recognized on-chain. The pool state refreshed between scan and verification. Please retry shortly.",
      });
    }

    return res.status(200).json({
      ok: true,
      context: {
        root,
        pathElements: proof.pathElements.map((p) => ethers.hexlify(p)),
        pathIsRight: proof.pathIsRight,
        leafIndex: proof.leafIndex,
        depositCount: proof.depositCount,
        latestBlock: lastScannedBlock,
        totalDeposits: commitments.length,
      },
    });
  } catch (err) {
    // Honor typed statuses (429 rate limit, 403 allowlist, …) instead of
    // flattening everything to 500 — the client keys its retry logic off them.
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
