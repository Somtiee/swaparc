import { kv } from "../../../lib/server/kv.js";

const MEMORY = globalThis.__privpayBillsMemory || (globalThis.__privpayBillsMemory = {});

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
    const state = JSON.parse(
      JSON.stringify({
        bills: Array.isArray(rawState.bills) ? rawState.bills.slice(0, 1000) : [],
        updatedAt: new Date().toISOString(),
      })
    );

    const key = `privpay:bills:state:${ownerRaw}`;
    try {
      await kv.set(key, state);
    } catch {
      MEMORY[key] = state;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

