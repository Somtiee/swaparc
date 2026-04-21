import { kv } from "../../../lib/server/kv.js";

async function safeKvCall(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function computeEarlySwaparcer(profile) {
  const count = Number(profile?.swapCount || 0);
  const vol = Number(profile?.swapVolume || 0);
  const lp = Number(profile?.lpProvided || 0);
  return count >= 100 || vol >= 10000 || lp >= 1000;
}

async function getProfileByOwner(owner) {
  const lower = String(owner || "").toLowerCase();
  if (!lower || !lower.startsWith("0x")) return null;
  const walletKey = `profile:${lower}`;
  // Primary profile storage uses hash fields; keep string get for legacy fallback.
  const walletProfile =
    (await safeKvCall(() => kv.hgetall(walletKey), null)) ||
    (await safeKvCall(() => kv.get(walletKey), null));
  if (walletProfile) return walletProfile;
  const mapped = await safeKvCall(() => kv.get(`wallet:${lower}`), null);
  if (mapped) {
    return (
      (await safeKvCall(() => kv.hgetall(`profile:${mapped}`), null)) ||
      (await safeKvCall(() => kv.get(`profile:${mapped}`), null))
    );
  }
  return null;
}

export async function getArcpayAccessByAddress(owner) {
  const normalizedOwner = String(owner || "").trim().toLowerCase();
  if (!normalizedOwner) {
    return {
      ok: false,
      reason: "missing-owner",
      plan: "none",
      recurringPayments: false,
      payrollAutomation: false,
      advancedPrivacy: false,
      isEarlySwaparcer: false,
      subscriptionActive: false,
      expiresAt: null,
    };
  }

  const profile = await getProfileByOwner(normalizedOwner);
  const isEarlySwaparcer = computeEarlySwaparcer(profile || {});

  const subKey = `privpay:subscription:${normalizedOwner}`;
  const sub = (await safeKvCall(() => kv.get(subKey), null)) || null;
  const expiresAt = sub?.expiresAt || null;
  const subscriptionActive =
    !!expiresAt && Number.isFinite(new Date(expiresAt).getTime())
      ? new Date(expiresAt).getTime() > Date.now()
      : false;

  const unlocked = isEarlySwaparcer || subscriptionActive;
  return {
    ok: true,
    owner: normalizedOwner,
    plan: isEarlySwaparcer ? "early-swaparcer-free" : subscriptionActive ? "monthly" : "usage-fee",
    recurringPayments: true,
    payrollAutomation: true,
    advancedPrivacy: unlocked,
    isEarlySwaparcer,
    subscriptionActive,
    expiresAt: subscriptionActive ? expiresAt : null,
  };
}

