import { kv } from "../../../lib/server/kv.js";

const MEMORY =
  globalThis.__privpayHistoryMemory || (globalThis.__privpayHistoryMemory = {});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.body?.owner || "").trim().toLowerCase();
    if (!ownerRaw || !ownerRaw.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Missing owner in body" });
    }

    const rawState = req.body?.state || {};
    const dedupStringArray = (arr, max = 2000) => {
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
    };

    const key = `privpay:history:state:${ownerRaw}`;
    let existing = null;
    try {
      existing = await kv.get(key);
    } catch {
      existing = MEMORY[key] || null;
    }
    existing = existing || {};

    // Merge: server is the single source of truth. For resolved-id sets take
    // the union (resolved is monotonic). For history arrays let the client
    // upsert by id (it already de-duplicates on save).
    const mergedResolvedBillIds = dedupStringArray(
      [
        ...(Array.isArray(existing.resolvedBillIds) ? existing.resolvedBillIds : []),
        ...dedupStringArray(rawState.resolvedBillIds),
      ]
    );
    const mergedResolvedPayrollIds = dedupStringArray(
      [
        ...(Array.isArray(existing.resolvedPayrollIds) ? existing.resolvedPayrollIds : []),
        ...dedupStringArray(rawState.resolvedPayrollIds),
      ]
    );

    const state = JSON.parse(
      JSON.stringify({
        billHistory: Array.isArray(rawState.billHistory)
          ? rawState.billHistory.slice(0, 1000)
          : Array.isArray(existing.billHistory)
          ? existing.billHistory
          : [],
        claimHistory: Array.isArray(rawState.claimHistory)
          ? rawState.claimHistory.slice(0, 1000)
          : Array.isArray(existing.claimHistory)
          ? existing.claimHistory
          : [],
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

