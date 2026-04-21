import { ethers } from "ethers";
import { kv } from "../../lib/server/kv.js";
import { PrivacyPoolPoseidonMerkleMirror } from "../../scripts/privacyPoolPoseidonMerkle.mjs";

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
const MAX_CHUNKS_PER_REQUEST = Math.max(
  1,
  Math.min(400, Number(process.env.PRIVPAY_CLAIM_CONTEXT_CHUNKS || 60))
);

function parseFromBlock(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function providerUrls() {
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

function getProviders(urls) {
  return urls.map((url) => ({
    url,
    provider: new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 }),
  }));
}

function logKey(log) {
  return `${String(log.blockNumber || "")}:${String(log.transactionHash || "")}:${String(log.logIndex || "")}`;
}

function sortLogs(logs) {
  return logs.sort((a, b) => {
    const ba = Number(a.blockNumber || 0);
    const bb = Number(b.blockNumber || 0);
    if (ba !== bb) return ba - bb;
    return Number(a.logIndex || 0) - Number(b.logIndex || 0);
  });
}

async function getLogsUnion(providers, params) {
  const settled = await Promise.allSettled(
    providers.map(({ provider }) => provider.getLogs(params))
  );
  const seen = new Map();
  let anyOk = false;
  for (const r of settled) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      anyOk = true;
      for (const log of r.value) seen.set(logKey(log), log);
    }
  }
  if (!anyOk) throw new Error("All RPC providers failed for getLogs window.");
  return sortLogs(Array.from(seen.values()));
}

async function getLatestBlockQuorum(providers) {
  const settled = await Promise.allSettled(
    providers.map(({ provider }) => provider.getBlockNumber())
  );
  const nums = settled
    .filter((r) => r.status === "fulfilled" && Number.isFinite(Number(r.value)))
    .map((r) => Number(r.value));
  if (!nums.length) throw new Error("Failed to fetch latest block from providers.");
  return Math.max(...nums);
}

async function getOnchainState(providers, poolAddress) {
  for (const { provider } of providers) {
    try {
      const contract = new ethers.Contract(poolAddress, POOL_IFACE, provider);
      const [nextIndex, currentRoot] = await Promise.all([
        contract.nextIndex(),
        contract.currentRoot(),
      ]);
      return {
        nextIndex: Number(nextIndex),
        currentRoot: ethers.hexlify(currentRoot),
        contract,
      };
    } catch {
      // try next provider
    }
  }
  throw new Error("Failed to read on-chain nextIndex/currentRoot from any provider.");
}

async function isKnownRootMulti(providers, poolAddress, root) {
  for (const { provider } of providers) {
    try {
      const contract = new ethers.Contract(poolAddress, POOL_IFACE, provider);
      const known = await contract.isKnownRoot(root);
      if (known) return true;
    } catch {
      // try next
    }
  }
  return false;
}

function bytesEqHex(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

async function scanRangeUnion(providers, poolAddress, fromBlock, toBlock, window) {
  const seen = new Map();
  for (let cursor = fromBlock; cursor <= toBlock; cursor += window) {
    const end = Math.min(cursor + window - 1, toBlock);
    const logs = await getLogsUnion(providers, {
      address: poolAddress,
      fromBlock: cursor,
      toBlock: end,
      topics: [DEPOSITED_TOPIC],
    }).catch(() => []);
    for (const log of logs) seen.set(logKey(log), log);
  }
  return sortLogs(Array.from(seen.values()));
}

async function buildCanonicalHistory(providers, poolAddress, fromBlock, latest, expectedCount) {
  // Try progressively narrower windows until count matches expectedCount.
  for (const window of DEFAULT_WINDOWS) {
    const logs = await scanRangeUnion(providers, poolAddress, fromBlock, latest, window);
    if (logs.length >= expectedCount) {
      return logs;
    }
    // else try narrower window
  }
  // Final attempt: extremely narrow windows (single block aware)
  return await scanRangeUnion(providers, poolAddress, fromBlock, latest, 100);
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const poolAddress = ethers.getAddress(String(req.query?.poolAddress || ""));
    const commitment = ethers.zeroPadValue(String(req.query?.commitment || ""), 32);
    const merkleHeight = Math.max(16, Math.min(32, Number(req.query?.merkleHeight || 16)));
    const envFromBlock =
      process.env.PRIVPAY_POOL_FROM_BLOCK ||
      process.env.VITE_PRIVACY_POOL_FROM_BLOCK ||
      process.env.PRIVACY_POOL_FROM_BLOCK ||
      "0";
    const fromBlock = parseFromBlock(req.query?.fromBlock ?? envFromBlock);
    const urls = providerUrls();
    const providers = getProviders(urls);

    const snapshotKey = `privpay:pool:index:v3:${poolAddress.toLowerCase()}:${merkleHeight}:${fromBlock}`;

    const onchain = await getOnchainState(providers, poolAddress);
    const latest = await getLatestBlockQuorum(providers);

    const snap = (await kv.get(snapshotKey).catch(() => null)) || {};
    let commitments = Array.isArray(snap?.commitments) ? snap.commitments.slice() : [];
    let lastScannedBlock = Number.isFinite(Number(snap?.lastScannedBlock))
      ? Number(snap.lastScannedBlock)
      : fromBlock - 1;
    const cachedValidated = Boolean(snap?.validated);

    // If cache is valid & complete for current nextIndex, use it.
    const cacheComplete =
      cachedValidated &&
      commitments.length === onchain.nextIndex &&
      lastScannedBlock >= latest - 1;

    if (!cacheComplete) {
      // Rebuild from scratch using union across providers, with window fallback.
      commitments = [];
      lastScannedBlock = fromBlock - 1;

      // Bounded incremental scan with union
      let cursor = fromBlock;
      let scannedChunks = 0;
      let window = DEFAULT_WINDOWS[0];
      // accumulate logs in a map
      const seen = new Map();
      const tryScan = async (w) => {
        const logs = await getLogsUnion(providers, {
          address: poolAddress,
          fromBlock: cursor,
          toBlock: Math.min(cursor + w - 1, latest),
          topics: [DEPOSITED_TOPIC],
        }).catch(() => null);
        return logs;
      };

      while (cursor <= latest && scannedChunks < MAX_CHUNKS_PER_REQUEST) {
        const toBlock = Math.min(cursor + window - 1, latest);
        const logs = await tryScan(window);
        if (logs == null) {
          // total failure for this window, try narrower
          const narrower = DEFAULT_WINDOWS.find((w) => w < window) || 100;
          if (narrower === window) break;
          window = narrower;
          continue;
        }
        for (const log of logs) seen.set(logKey(log), log);
        cursor = toBlock + 1;
        lastScannedBlock = toBlock;
        scannedChunks += 1;
      }

      commitments = commitmentsFromLogs(sortLogs(Array.from(seen.values())));

      // If the count doesn't match on-chain nextIndex *and* we're complete up to latest,
      // we know providers missed logs. Retry once with narrower window over the whole range.
      if (
        lastScannedBlock >= latest &&
        commitments.length !== onchain.nextIndex
      ) {
        for (const retryWindow of DEFAULT_WINDOWS.slice(1).concat([100])) {
          const logs = await scanRangeUnion(
            providers,
            poolAddress,
            fromBlock,
            latest,
            retryWindow
          );
          if (logs.length >= onchain.nextIndex) {
            commitments = commitmentsFromLogs(logs);
            break;
          }
        }
      }

      // If still incomplete but we scanned to latest, persist what we have but mark not validated.
      const reachedLatest = lastScannedBlock >= latest;
      const countMatches = commitments.length === onchain.nextIndex;

      if (!reachedLatest) {
        // Save progress and ask client to poll again.
        await kv
          .set(snapshotKey, {
            commitments,
            lastScannedBlock,
            updatedAt: new Date().toISOString(),
            validated: false,
          })
          .catch(() => {});
        return res.status(202).json({
          ok: false,
          pending: true,
          progress: {
            scannedToBlock: lastScannedBlock,
            latestBlock: latest,
            chunksThisRequest: scannedChunks,
            knownDeposits: commitments.length,
            expectedDeposits: onchain.nextIndex,
          },
        });
      }

      if (!countMatches) {
        // Final safety: build proof against on-chain currentRoot expectation is impossible.
        // Invalidate the cache by NOT marking validated.
        await kv
          .set(snapshotKey, {
            commitments,
            lastScannedBlock,
            updatedAt: new Date().toISOString(),
            validated: false,
          })
          .catch(() => {});
        return res.status(503).json({
          ok: false,
          error:
            `Pool history incomplete from RPC providers. Expected ${onchain.nextIndex} deposits, got ${commitments.length}. Please retry in a few seconds.`,
        });
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
        .set(snapshotKey, {
          commitments,
          lastScannedBlock,
          updatedAt: new Date().toISOString(),
          validated: matchesCurrent,
        })
        .catch(() => {});

      if (!matchesCurrent) {
        return res.status(503).json({
          ok: false,
          error:
            "Pool history did not match on-chain root after full scan. Providers may be temporarily out of sync. Please retry shortly.",
        });
      }
    }

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
        .set(snapshotKey, {
          commitments,
          lastScannedBlock,
          updatedAt: new Date().toISOString(),
          validated: false,
        })
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
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
