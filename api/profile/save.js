import { kv } from "../../lib/server/kv.js";
import { isFrozenEarlySwaparcer } from "../../lib/server/earlySwaparcerFrozen.js";
import {
  assertOwnerAuth,
  sanitizeUsername,
  sanitizeAvatar,
} from "../security/walletAuth.js";

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

function sanitizeBadges(raw) {
  const parsed = parseBadges(raw);
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === true || v === "true") out[k] = true;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, username, walletId, avatar, walletAddress, swapCount, swapVolume, lpProvided } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const normalizedId = userId.startsWith("0x") ? userId.toLowerCase() : userId;
    const authAddress = String(walletAddress || (normalizedId.startsWith("0x") ? normalizedId : "")).toLowerCase();
    if (authAddress.startsWith("0x")) {
      await assertOwnerAuth(req, authAddress, "profile-save");
    }

    const profileKey = `profile:${normalizedId}`;
    const existingProfile = (await kv.hgetall(profileKey)) || {};

    const existingBadges = sanitizeBadges(existingProfile.badges);

    const finalSwapCount = Number(existingProfile.swapCount || 0);
    const finalSwapVolume = Number(existingProfile.swapVolume || 0);
    const finalLpProvided = Number(existingProfile.lpProvided || 0);

    // STRICT LOCK: snapshot membership is the only source of truth.
    // Existing stored true flags are ignored if wallet is not frozen.
    const candidateAddress = String(walletAddress || normalizedId || "").toLowerCase();
    const inFrozenSnapshot = candidateAddress
      ? await isFrozenEarlySwaparcer(candidateAddress)
      : false;
    const earlySwaparcerFlag = inFrozenSnapshot;

    const updatedBadges = { ...existingBadges };
    if (earlySwaparcerFlag) updatedBadges.earlySwaparcer = true;
    else delete updatedBadges.earlySwaparcer;

    const profile = {
      ...existingProfile,
      username: sanitizeUsername(username || existingProfile.username),
      walletId: walletId || existingProfile.walletId,
      avatar: sanitizeAvatar(avatar || existingProfile.avatar || ""),
      walletAddress: walletAddress || existingProfile.walletAddress || "",

      swapVolume: finalSwapVolume,
      swapCount: finalSwapCount,
      lpProvided: finalLpProvided,
      badges: updatedBadges
    };

    await kv.hset(profileKey, {
        ...profile,
        badges: JSON.stringify(updatedBadges)
    });

    if (finalSwapVolume > 0) {
      await kv.zadd("leaderboard:swapVolume", { score: finalSwapVolume, member: normalizedId });
    }
    if (finalSwapCount > 0) {
      await kv.zadd("leaderboard:swapCount", { score: finalSwapCount, member: normalizedId });
    }
    if (finalLpProvided > 0) {
      await kv.zadd("leaderboard:lpProvided", { score: finalLpProvided, member: normalizedId });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Save failed" });
  }
}
