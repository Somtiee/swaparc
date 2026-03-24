import { kv } from "@vercel/kv";

const MEMORY = globalThis.__privpayPayrollMemory || (globalThis.__privpayPayrollMemory = {});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const ownerRaw = String(req.body?.owner || "").trim().toLowerCase();
    if (!ownerRaw) {
      return res.status(400).json({ ok: false, error: "Missing owner in body" });
    }

    const rawState = req.body?.state || {};
    const state = {
      companies: Array.isArray(rawState.companies) ? rawState.companies : [],
      employees: Array.isArray(rawState.employees) ? rawState.employees : [],
      history: Array.isArray(rawState.history) ? rawState.history.slice(0, 1000) : [],
      updatedAt: new Date().toISOString(),
    };

    const key = `privpay:payroll:state:${ownerRaw}`;
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

