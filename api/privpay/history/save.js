import { kv } from "../../../lib/server/kv.js";
import { assertOwnerAuth } from "../../security/walletAuth.js";

const MEMORY =
  globalThis.__privpayHistoryMemory || (globalThis.__privpayHistoryMemory = {});

function dedupStringArray(arr, max = 2000) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = String(v || "");
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const TERMINAL = new Set(["confirmed", "failed"]);

function mergeHistoryById(existing, incoming, dateKey, max = 2000) {
  const byId = new Map();
  for (const e of Array.isArray(existing) ? existing : []) {
    if (e && e.id) byId.set(String(e.id), e);
  }
  for (const n of Array.isArray(incoming) ? incoming : []) {
    if (!n || !n.id) continue;
    const id = String(n.id);
    const prior = byId.get(id);
    if (!prior) {
      byId.set(id, n);
      continue;
    }
    const merged = { ...prior, ...n };
    // prior tx/claim/status fields should only progress forward
    if (prior.poolClaimedAt && !n.poolClaimedAt) merged.poolClaimedAt = prior.poolClaimedAt;
    if (prior.txHash && prior.txHash !== "SUBMITTED") {
      if (!n.txHash || n.txHash === "SUBMITTED") merged.txHash = prior.txHash;
    }
    // status: don't let a stale pending overwrite a terminal status
    if (prior.status && TERMINAL.has(String(prior.status))) {
      if (!n.status || !TERMINAL.has(String(n.status))) {
        merged.status = prior.status;
      }
    }
    byId.set(id, merged);
  }
  const all = Array.from(byId.values());
  all.sort(
    (a, b) => new Date(b?.[dateKey] || 0).getTime() - new Date(a?.[dateKey] || 0).getTime()
  );
  return all.slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.body?.owner || "").trim().toLowerCase();
    if (!ownerRaw || !ownerRaw.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Missing owner in body" });
    }
    await assertOwnerAuth(req, ownerRaw, "privpay-history-save");

    const rawState = req.body?.state || {};

    const key = `privpay:history:state:${ownerRaw}`;
    let existing = null;
    try {
      existing = await kv.get(key);
    } catch {
      existing = MEMORY[key] || null;
    }
    existing = existing || {};

    const mergedBillHistory = mergeHistoryById(
      existing.billHistory,
      rawState.billHistory,
      "createdAt",
      2000
    );
    const mergedClaimHistory = mergeHistoryById(
      existing.claimHistory,
      rawState.claimHistory,
      "claimedAt",
      2000
    );

    const mergedResolvedBillIds = dedupStringArray([
      ...(Array.isArray(existing.resolvedBillIds) ? existing.resolvedBillIds : []),
      ...dedupStringArray(rawState.resolvedBillIds),
    ]);
    const mergedResolvedPayrollIds = dedupStringArray([
      ...(Array.isArray(existing.resolvedPayrollIds) ? existing.resolvedPayrollIds : []),
      ...dedupStringArray(rawState.resolvedPayrollIds),
    ]);

    const state = JSON.parse(
      JSON.stringify({
        billHistory: mergedBillHistory,
        claimHistory: mergedClaimHistory,
        resolvedBillIds: mergedResolvedBillIds,
        resolvedPayrollIds: mergedResolvedPayrollIds,
        updatedAt: new Date().toISOString(),
      })
    );

    try {
      await kv.set(key, state);
    } catch {
      MEMORY[key] = state;
    }

    return res.status(200).json({ ok: true, state });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
