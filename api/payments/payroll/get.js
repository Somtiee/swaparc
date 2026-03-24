import { kv } from "@vercel/kv";

const MEMORY = globalThis.__privpayPayrollMemory || (globalThis.__privpayPayrollMemory = {});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.query?.owner || "").trim().toLowerCase();
    if (!ownerRaw) {
      return res.status(400).json({ ok: false, error: "Missing owner query param" });
    }

    const key = `privpay:payroll:state:${ownerRaw}`;
    let state = null;
    try {
      state = await kv.get(key);
    } catch {
      state = MEMORY[key] || null;
    }

    if (!state) {
      state = { companies: [], employees: [], history: [] };
    }

    return res.status(200).json({ ok: true, state });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

