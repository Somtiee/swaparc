import { ethers } from "ethers";
import { kv } from "../../lib/server/kv.js";
import { PrivacyPoolPoseidonMerkleMirror } from "../../scripts/privacyPoolPoseidonMerkle.mjs";

const DEPOSITED_IFACE = new ethers.Interface([
  "event Deposited(bytes32 indexed commitment, uint256 amount)",
]);
const DEPOSITED_TOPIC = ethers.id("Deposited(bytes32,uint256)");
const CHUNK = 9999;

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

async function getProviders(urls) {
  return urls.map((url) => ({
    url,
    provider: new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 }),
  }));
}

function logKey(log) {
  return `${String(log.blockNumber || "")}:${String(log.transactionHash || "")}:${String(log.logIndex || "")}`;
}

async function getLogsQuorum(providers, params) {
  const settled = await Promise.allSettled(
    providers.map(({ provider }) => provider.getLogs(params))
  );
  const ok = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v) => Array.isArray(v));
  if (!ok.length) {
    throw new Error("Failed to fetch logs from all configured providers.");
  }
  const byKey = new Map();
  for (const arr of ok) {
    for (const log of arr) {
      byKey.set(logKey(log), log);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (Number(a.blockNumber || 0) !== Number(b.blockNumber || 0)) {
      return Number(a.blockNumber || 0) - Number(b.blockNumber || 0);
    }
    return Number(a.logIndex || 0) - Number(b.logIndex || 0);
  });
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

function bytesEqHex(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
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
    const snapshotKey = `privpay:pool:index:v2:${poolAddress.toLowerCase()}:${merkleHeight}:${fromBlock}`;
    const providers = await getProviders(urls);

    const snap = (await kv.get(snapshotKey).catch(() => null)) || {};
    const commitments = Array.isArray(snap?.commitments) ? snap.commitments.slice() : [];
    let lastScannedBlock = Number.isFinite(Number(snap?.lastScannedBlock))
      ? Number(snap.lastScannedBlock)
      : fromBlock - 1;

    const latest = await getLatestBlockQuorum(providers);
    const startScan = Math.max(fromBlock, lastScannedBlock + 1);

    for (let cursor = startScan; cursor <= latest; cursor += CHUNK) {
      const toBlock = Math.min(cursor + CHUNK, latest);
      const logs = await getLogsQuorum(providers, {
        address: poolAddress,
        fromBlock: cursor,
        toBlock,
        topics: [DEPOSITED_TOPIC],
      });
      for (const log of logs) {
        const parsed = DEPOSITED_IFACE.parseLog(log);
        commitments.push(ethers.zeroPadValue(parsed.args.commitment, 32).toLowerCase());
      }
      lastScannedBlock = toBlock;
    }

    await kv
      .set(snapshotKey, {
        commitments,
        lastScannedBlock,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});

    let leafIndex = -1;
    for (let i = 0; i < commitments.length; i += 1) {
      if (bytesEqHex(commitments[i], commitment)) {
        leafIndex = i;
        break;
      }
    }
    if (leafIndex < 0) {
      return res.status(404).json({
        ok: false,
        error:
          "Commitment not found in canonical pool history. Check claim code recipient/pool and from-block configuration.",
      });
    }

    const mirror = await PrivacyPoolPoseidonMerkleMirror.create(merkleHeight);
    for (const c of commitments) {
      await mirror.insert(ethers.getBytes(c));
    }
    const proof = await mirror.getMerkleProof(leafIndex, commitments.length);

    return res.status(200).json({
      ok: true,
      context: {
        root: ethers.hexlify(proof.root),
        pathElements: proof.pathElements.map((p) => ethers.hexlify(p)),
        pathIsRight: proof.pathIsRight,
        leafIndex: proof.leafIndex,
        depositCount: proof.depositCount,
        latestBlock: lastScannedBlock,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

