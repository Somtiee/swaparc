/**
 * Swaparc KV: Redis (TCP `REDIS_URL`) or legacy Upstash REST (`KV_REST_*` + @vercel/kv).
 * Prefer Redis on Railway / managed Redis to avoid per-request Upstash billing.
 */
import { Redis } from "ioredis";
import { createClient as createVercelKv } from "@vercel/kv";

function hasRedisUrl() {
  const u = String(process.env.REDIS_URL || "").trim();
  return u.startsWith("redis://") || u.startsWith("rediss://");
}

function serializeStored(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function deserializeStored(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (!t) return raw;
  if (t[0] === "{" || t[0] === "[" || t === "true" || t === "false" || t === "null") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

function normalizeHashFields(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

function parseHashField(value) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  if (s === "") return "";
  if (s[0] === "{" || s[0] === "[" || s === "true" || s === "false" || s === "null") {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s.trim())) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

function createRedisKvAdapter(redis) {
  return {
    async get(key) {
      const raw = await redis.get(key);
      if (raw === null) return null;
      return deserializeStored(raw);
    },

    async set(key, value, opts = {}) {
      const payload = serializeStored(value);
      if (opts?.nx && opts?.ex) {
        const r = await redis.set(key, payload, "EX", Number(opts.ex), "NX");
        return r === "OK";
      }
      if (opts?.ex) {
        await redis.set(key, payload, "EX", Number(opts.ex));
        return "OK";
      }
      await redis.set(key, payload);
      return "OK";
    },

    async del(...keys) {
      if (!keys.length) return 0;
      return redis.del(...keys);
    },

    async hgetall(key) {
      const h = await redis.hgetall(key);
      if (!h || Object.keys(h).length === 0) return null;
      const out = {};
      for (const [k, v] of Object.entries(h)) {
        out[k] = parseHashField(v);
      }
      return out;
    },

    async hset(key, obj) {
      const flat = normalizeHashFields(obj);
      const pairs = Object.entries(flat);
      if (pairs.length === 0) return 0;
      return redis.hset(key, ...pairs.flat());
    },

    async hincrby(key, field, inc) {
      return redis.hincrby(key, field, inc);
    },

    async hincrbyfloat(key, field, inc) {
      const v = await redis.hincrbyfloat(key, field, inc);
      return Number(v);
    },

    async incr(key) {
      return redis.incr(key);
    },

    async expire(key, seconds) {
      return redis.expire(key, seconds);
    },

    async sadd(key, ...members) {
      if (!members.length) return 0;
      return redis.sadd(key, ...members);
    },

    async smembers(key) {
      const m = await redis.smembers(key);
      return Array.isArray(m) ? m : [];
    },

    async lpush(key, ...vals) {
      if (!vals.length) return 0;
      return redis.lpush(key, ...vals);
    },

    async lrange(key, start, stop) {
      return redis.lrange(key, start, stop);
    },

    async zadd(key, arg) {
      if (arg && typeof arg === "object" && "score" in arg && "member" in arg) {
        return redis.zadd(key, Number(arg.score), String(arg.member));
      }
      throw new Error("zadd expects { score, member }");
    },

    async zrevrange(key, start, stop, opts = {}) {
      const s = Number(start) || 0;
      const e = Number(stop);
      if (opts?.withScores) {
        const flat = await redis.zrevrange(key, s, e, "WITHSCORES");
        const out = [];
        for (let i = 0; i < flat.length; i += 2) {
          out.push({ member: String(flat[i]), score: Number(flat[i + 1]) || 0 });
        }
        return out;
      }
      const members = await redis.zrevrange(key, s, e);
      return Array.isArray(members) ? members.map(String) : [];
    },

    async scan(cursor, opts = {}) {
      const match = opts.match || "*";
      const count = Math.max(1, Number(opts.count) || 100);
      const cur = cursor === "0" || cursor === 0 ? "0" : String(cursor);
      const [nextCursor, keys] = await redis.scan(cur, "MATCH", match, "COUNT", count);
      return [nextCursor, keys];
    },

    /**
     * Profiles are usually HASH (hincrby / hset); some legacy rows use STRING JSON (kv.set).
     */
    async mget(...keys) {
      if (!keys.length) return [];
      return Promise.all(
        keys.map(async (k) => {
          const h = await redis.hgetall(k);
          if (h && Object.keys(h).length) {
            const o = {};
            for (const [fk, fv] of Object.entries(h)) {
              o[fk] = parseHashField(fv);
            }
            return o;
          }
          const raw = await redis.get(k);
          if (raw == null || raw === "") return null;
          return deserializeStored(raw);
        })
      );
    },

    pipeline() {
      const p = redis.pipeline();
      return {
        hgetall(key) {
          p.hgetall(key);
          return this;
        },
        exec() {
          return p.exec().then((rows) =>
            rows.map((pair) => {
              const err = pair[0];
              const hVal = pair[1];
              if (err) return null;
              if (!hVal || typeof hVal !== "object") return null;
              const o = {};
              for (const [k, v] of Object.entries(hVal)) {
                o[k] = parseHashField(v);
              }
              return o;
            })
          );
        },
      };
    },
  };
}

let cachedRedis = null;
let cachedAdapter = null;
let cachedVercel = null;

function getAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (hasRedisUrl()) {
    if (!cachedRedis) {
      const url = String(process.env.REDIS_URL).trim();
      cachedRedis = new Redis(url, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
    }
    cachedAdapter = createRedisKvAdapter(cachedRedis);
    return cachedAdapter;
  }

  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error(
      "KV store not configured: set REDIS_URL (recommended) or KV_REST_API_URL + KV_REST_API_TOKEN (Upstash legacy)."
    );
  }
  if (!cachedVercel) {
    cachedVercel = createVercelKv({ url, token });
  }
  cachedAdapter = cachedVercel;
  return cachedAdapter;
}

/** Default singleton used by API routes (lazy). */
export const kv = new Proxy(
  {},
  {
    get(_, prop) {
      const a = getAdapter();
      const fn = a[prop];
      if (typeof fn === "function") return fn.bind(a);
      return fn;
    },
  }
);

/**
 * For scripts: same resolution as `kv` (Redis first, else Upstash).
 * Optional `opts` accepted for compatibility with createClient({ url, token }) — env wins.
 */
export function createClient(_opts) {
  return getAdapter();
}
