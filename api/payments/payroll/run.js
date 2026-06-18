import { ethers } from "ethers";
import { kv } from "../../../lib/server/kv.js";
import { computeNextExecutionDate } from "../recurring-engine.js";
import { getArcpayAccessByAddress } from "../subscription-eligibility.js";
import { executeRecurringPrivpayDeposit } from "../../../lib/server/recurringPrivpayExecution.js";
import { assertCronAuthStrict } from "../../security/walletAuth.js";

const OWNER_SET = "privpay:payroll:owners";
const MEMORY = globalThis.__privpayPayrollMemory || (globalThis.__privpayPayrollMemory = {});
const MEMORY_OWNERS =
  globalThis.__privpayPayrollOwners || (globalThis.__privpayPayrollOwners = new Set());

/**
 * Serialize payroll runs per owner so overlapping POSTs (client tick + manual run + cron)
 * cannot both read "due" state and execute twice — that caused success + chained failures
 * and KV last-write clobbering nextRunAt.
 */
const ownerPayrollRunChain =
  globalThis.__privpayPayrollRunChain || (globalThis.__privpayPayrollRunChain = new Map());

async function runOwnerSerialized(ownerLower) {
  const key = String(ownerLower || "").toLowerCase();
  const prev = ownerPayrollRunChain.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => runOwner(key, new Date()));
  ownerPayrollRunChain.set(key, next);
  try {
    return await next;
  } finally {
    if (ownerPayrollRunChain.get(key) === next) {
      ownerPayrollRunChain.delete(key);
    }
  }
}

function serverExecutionEnabled() {
  return (
    String(process.env.RECURRING_SERVER_EXECUTION_ENABLED || "").toLowerCase() ===
    "true"
  );
}

function tokenAddressForCompany(company) {
  if (company?.tokenAddress) return String(company.tokenAddress);
  if (String(company?.token || "").toUpperCase() === "USDC") {
    return String(
      process.env.PRIVPAY_USDC_ADDRESS ||
        process.env.VITE_PRIVPAY_USDC_ADDRESS ||
        process.env.ARCPAY_USDC_ADDRESS ||
        process.env.VITE_ARCPAY_USDC_ADDRESS ||
        "0x3600000000000000000000000000000000000000"
    );
  }
  return "";
}

async function getOwners() {
  try {
    const fromKv = await kv.smembers(OWNER_SET);
    if (Array.isArray(fromKv) && fromKv.length) return fromKv.map((v) => String(v));
  } catch {
    // ignore
  }
  return Array.from(MEMORY_OWNERS);
}

async function getState(owner) {
  const key = `privpay:payroll:state:${owner}`;
  try {
    const state = await kv.get(key);
    if (state) return state;
  } catch {
    // ignore
  }
  return MEMORY[key] || { companies: [], employees: [], history: [] };
}

async function saveState(owner, state) {
  const key = `privpay:payroll:state:${owner}`;
  try {
    await kv.set(key, state);
    await kv.sadd(OWNER_SET, owner);
  } catch {
    MEMORY[key] = state;
    MEMORY_OWNERS.add(owner);
  }
}

function hasAutomationAccess(access) {
  return !!(access?.payrollAutomation || access?.recurringPayments);
}

async function runOwner(owner, now) {
  const access = await getArcpayAccessByAddress(owner);
  if (!hasAutomationAccess(access)) {
    return { owner, checked: 0, due: 0, success: 0, failed: 0, skipped: 0, details: [] };
  }

  const rawState = await getState(owner);
  const companies = Array.isArray(rawState?.companies) ? rawState.companies : [];
  const employees = Array.isArray(rawState?.employees) ? rawState.employees : [];
  const history = Array.isArray(rawState?.history) ? rawState.history.slice(0, 1000) : [];
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const due = employees.filter(
    (e) =>
      e?.status === "active" &&
      !!e?.recurring &&
      !!e?.nextRunAt &&
      Number.isFinite(new Date(e.nextRunAt).getTime()) &&
      new Date(e.nextRunAt).getTime() <= now.getTime()
  );

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const details = [];
  const logs = [];

  for (const emp of due) {
    const company = companyById.get(emp.companyId);
    const tokenAddress = tokenAddressForCompany(company);
    if (!tokenAddress || !String(tokenAddress).startsWith("0x")) {
      skipped += 1;
      details.push({
        employeeId: emp.id,
        skipped: true,
        reason: "missing-token-address",
      });
      continue;
    }

    try {
      const result = await executeRecurringPrivpayDeposit({
        id: `payroll_${owner}_${emp.id}`,
        payerAddress: owner,
        recipientWallet: String(emp.recipientWallet || "").trim(),
        amount: Number(emp.salary || 0),
        tokenAddress,
        metadata: {
          employeeId: emp.id,
          employeeName: emp.name || "",
          companyId: emp.companyId || "",
          companyName: company?.name || "",
          /** Must match client `ensureRecurringOnchainAuthorization` (ethers.id(employeeId)). */
          onchainAuthorizationId: ethers.id(String(emp.id || "")),
        },
      });
      success += 1;
      details.push({ employeeId: emp.id, ok: true, txHash: result.txHash });
      logs.push({
        id: `pr_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        companyId: emp.companyId,
        companyName: company?.name || "",
        employeeId: emp.id,
        employeeName: emp.name || "",
        role: emp.role || "",
        token: company?.token || "USDC",
        amount: emp.salary,
        paymentRail: "privacyPool",
        status: "submitted",
        payerAddress: owner,
        poolAddress: result.poolAddress || null,
        poolNullifierHash: result.poolNullifierHash || null,
        poolRecipient: result.poolRecipient || null,
        poolCommitment: result.poolCommitment || null,
        poolClaimCode: result.poolClaimCode || null,
        txHash: result.txHash || null,
        blockNumber: result.blockNumber != null ? Number(result.blockNumber) : null,
        createdAt: now.toISOString(),
        payrollExecution: "recurring",
      });
    } catch (e) {
      failed += 1;
      const msg = e?.message || String(e);
      details.push({ employeeId: emp.id, ok: false, error: msg });
      logs.push({
        id: `pr_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        companyId: emp.companyId,
        companyName: company?.name || "",
        employeeId: emp.id,
        employeeName: emp.name || "",
        role: emp.role || "",
        token: company?.token || "USDC",
        amount: emp.salary,
        status: "failed",
        error: msg,
        createdAt: now.toISOString(),
        payrollExecution: "recurring",
      });
    }
  }

  const updatedEmployees = employees.map((emp) => {
    if (!due.some((d) => d.id === emp.id)) return emp;
    const hit = details.find((d) => d.employeeId === emp.id);
    if (!hit || hit.skipped) return emp;
    if (!hit.ok) {
      return {
        ...emp,
        nextRunAt: new Date(now.getTime() + 90 * 1000).toISOString(),
        failureReason: hit.error || "Recurring payroll run failed",
      };
    }
    return {
      ...emp,
      lastPaidAt: now.toISOString(),
      failureReason: null,
      nextRunAt: computeNextExecutionDate({
        frequency: emp.frequency || "monthly",
        customIntervalSeconds: emp.customIntervalSeconds || null,
        lastExecutionAt: now.toISOString(),
        startAt: emp.nextRunAt || emp.createdAt || now.toISOString(),
        now,
      }),
    };
  });

  await saveState(owner, {
    companies,
    employees: updatedEmployees,
    history: [...logs, ...history].slice(0, 1000),
    updatedAt: now.toISOString(),
  });

  return {
    owner,
    checked: employees.length,
    due: due.length,
    success,
    failed,
    skipped,
    details,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const owner = String(body?.owner || req.query?.owner || "").trim().toLowerCase();
    const now = new Date();

    if (!serverExecutionEnabled()) {
      return res.status(200).json({
        ok: true,
        summary: { checked: 0, due: 0, success: 0, failed: 0, skipped: 0, details: [] },
        note: "Server-side recurring execution disabled (set RECURRING_SERVER_EXECUTION_ENABLED=true).",
      });
    }

    if (owner) {
      const summary = await runOwnerSerialized(owner);
      return res.status(200).json({ ok: true, summary });
    }

    assertCronAuthStrict(req);
    const owners = await getOwners();
    const results = [];
    for (const o of owners) {
      results.push(await runOwnerSerialized(String(o).toLowerCase()));
    }

    return res.status(200).json({
      ok: true,
      summary: {
        owners: owners.length,
        checked: results.reduce((n, r) => n + (r.checked || 0), 0),
        due: results.reduce((n, r) => n + (r.due || 0), 0),
        success: results.reduce((n, r) => n + (r.success || 0), 0),
        failed: results.reduce((n, r) => n + (r.failed || 0), 0),
        skipped: results.reduce((n, r) => n + (r.skipped || 0), 0),
        results,
      },
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
