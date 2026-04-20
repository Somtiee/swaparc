import { kv } from "../../../lib/server/kv.js";

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
    (await kv.hgetall(walletKey).catch(() => null)) ||
    (await kv.get(walletKey).catch(() => null));
  if (walletProfile) return walletProfile;
  const mapped = await kv.get(`wallet:${lower}`).catch(() => null);
  if (mapped) {
    return (
      (await kv.hgetall(`profile:${mapped}`).catch(() => null)) ||
      (await kv.get(`profile:${mapped}`).catch(() => null))
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
  const sub = (await kv.get(subKey).catch(() => null)) || null;
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

