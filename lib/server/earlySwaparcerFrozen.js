import { kv } from "./kv.js";
import { readFile } from "node:fs/promises";

const KV_KEY = "badges:earlySwaparcer:frozen";
const FILE_URL = new URL("../../data/badges/earlySwaparcer.frozen.json", import.meta.url);
const KV_TIMEOUT_MS = 1500;
const MEMORY_TTL_MS = 5 * 60 * 1000;

let cache = null; // { set: Set<string>, loadedAt: number }
let inflight = null;

function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function normalizeAddress(value) {
  if (!value) return "";
  const s = String(value).trim().toLowerCase();
  return s;
}

function pickAddresses(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.addresses)) return input.addresses;
  if (Array.isArray(input.holders)) return input.holders;
  if (Array.isArray(input.entries)) {
    return input.entries
      .map((e) => e?.userId || e?.walletAddress || e?.address)
      .filter(Boolean);
  }
  return [];
}

async function loadFromKv() {
  const raw = await withTimeout(
    Promise.resolve()
      .then(() => kv.get(KV_KEY))
      .catch(() => null),
    KV_TIMEOUT_MS,
    null
  );
  return pickAddresses(raw);
}

async function loadFromFile() {
  try {
    const raw = await readFile(FILE_URL, "utf8");
    if (!raw) return [];
    return pickAddresses(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function loadFrozenSet() {
  const merged = new Set();

  const fromKv = await loadFromKv();
  for (const a of fromKv) {
    const n = normalizeAddress(a);
    if (n) merged.add(n);
  }

  const fromFile = await loadFromFile();
  for (const a of fromFile) {
    const n = normalizeAddress(a);
    if (n) merged.add(n);
  }

  return merged;
}

async function getFrozenSet() {
  const now = Date.now();
  if (cache && now - cache.loadedAt < MEMORY_TTL_MS) {
    return cache.set;
  }
  if (inflight) return inflight;
  inflight = loadFrozenSet()
    .then((set) => {
      cache = { set, loadedAt: Date.now() };
      inflight = null;
      return set;
    })
    .catch(() => {
      inflight = null;
      return cache?.set || new Set();
    });
  return inflight;
}

export async function isFrozenEarlySwaparcer(address) {
  const norm = normalizeAddress(address);
  if (!norm) return false;
  const set = await getFrozenSet();
  return set.has(norm);
}

export async function getFrozenEarlySwaparcerAddresses() {
  const set = await getFrozenSet();
  return Array.from(set);
}

export function invalidateFrozenEarlySwaparcerCache() {
  cache = null;
}

export const EARLY_SWAPARCER_FROZEN_KV_KEY = KV_KEY;
