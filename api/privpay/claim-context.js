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

async function callWithProviders(urls, fn) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
      return await fn(provider, url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All RPC providers failed.");
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
    const snapshotKey = `privpay:pool:index:${poolAddress.toLowerCase()}:${merkleHeight}:${fromBlock}`;

    const snap = (await kv.get(snapshotKey).catch(() => null)) || {};
    const commitments = Array.isArray(snap?.commitments) ? snap.commitments.slice() : [];
    let lastScannedBlock = Number.isFinite(Number(snap?.lastScannedBlock))
      ? Number(snap.lastScannedBlock)
      : fromBlock - 1;

    const latest = await callWithProviders(urls, async (provider) => provider.getBlockNumber());
    const startScan = Math.max(fromBlock, lastScannedBlock + 1);

    for (let cursor = startScan; cursor <= latest; cursor += CHUNK) {
      const toBlock = Math.min(cursor + CHUNK, latest);
      const logs = await callWithProviders(urls, async (provider) =>
        provider.getLogs({
          address: poolAddress,
          fromBlock: cursor,
          toBlock,
          topics: [DEPOSITED_TOPIC],
        })
      );
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

