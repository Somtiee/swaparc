import { kv } from "../../lib/server/kv.js";
import { isFrozenEarlySwaparcer } from "../../lib/server/earlySwaparcerFrozen.js";

async function safeKvCall(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function parseBadges(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Early Swaparcer claiming is FROZEN. We no longer compute eligibility from
 * live stats. A wallet is treated as an Early Swaparcer if and only if:
 *  - their stored profile already has badges.earlySwaparcer = true, OR
 *  - their address is in the pre-freeze snapshot
 *    (badges:earlySwaparcer:frozen / data/badges/earlySwaparcer.frozen.json).
 */
async function resolveEarlySwaparcer(profile, normalizedOwner) {
  const badges = parseBadges(profile?.badges);
  if (badges?.earlySwaparcer === true || badges?.earlySwaparcer === "true") {
    return true;
  }
  if (!normalizedOwner) return false;
  return isFrozenEarlySwaparcer(normalizedOwner);
}

async function getProfileByOwner(owner) {
  const lower = String(owner || "").toLowerCase();
  if (!lower || !lower.startsWith("0x")) return null;
  const walletKey = `profile:${lower}`;
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
  const isEarlySwaparcer = await resolveEarlySwaparcer(profile || {}, normalizedOwner);

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
