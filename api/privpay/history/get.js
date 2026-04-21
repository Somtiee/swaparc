import { kv } from "../../../lib/server/kv.js";

const MEMORY =
  globalThis.__privpayHistoryMemory || (globalThis.__privpayHistoryMemory = {});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.query?.owner || "").trim().toLowerCase();
    if (!ownerRaw || !ownerRaw.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Missing owner query param" });
    }

    const key = `privpay:history:state:${ownerRaw}`;
    let state = null;
    try {
      state = await kv.get(key);
    } catch {
      state = MEMORY[key] || null;
    }

    if (!state) {
      state = { billHistory: [], claimHistory: [] };
    }

    return res.status(200).json({ ok: true, state });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

