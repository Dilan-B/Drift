import AsyncStorage from "@react-native-async-storage/async-storage";

const memory = new Map();

const now = () => Date.now();

function windowKey(key) {
  return `drift_rate_${key}`;
}

export async function checkRateLimit(key, { limit, windowMs }) {
  const storageKey = windowKey(key);
  const t = now();
  let hits = [];
  try {
    hits = JSON.parse((await AsyncStorage.getItem(storageKey)) || "[]");
  } catch {
    hits = [];
  }
  hits = hits.filter(ts => t - ts < windowMs);
  if (hits.length >= limit) {
    const retryMs = Math.max(0, windowMs - (t - hits[0]));
    const err = new Error(`Too many attempts. Try again in ${Math.ceil(retryMs / 1000)}s.`);
    err.code = "rate_limited";
    err.retryMs = retryMs;
    throw err;
  }
  hits.push(t);
  await AsyncStorage.setItem(storageKey, JSON.stringify(hits)).catch(() => {});
}

export async function rateLimited(key, opts, fn) {
  await checkRateLimit(key, opts);
  return fn();
}

export async function cached(key, ttlMs, fn, { force = false } = {}) {
  const t = now();
  const hit = memory.get(key);
  if (!force && hit && t - hit.ts < ttlMs) return hit.value;

  const storageKey = `drift_cache_${key}`;
  if (!force) {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (t - parsed.ts < ttlMs) {
          memory.set(key, parsed);
          return parsed.value;
        }
      }
    } catch {}
  }

  const value = await fn();
  const payload = { ts: t, value };
  memory.set(key, payload);
  AsyncStorage.setItem(storageKey, JSON.stringify(payload)).catch(() => {});
  return value;
}

export function invalidateCache(prefix) {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  const storagePrefix = `drift_cache_${prefix}`;
  AsyncStorage.getAllKeys()
    .then(keys => AsyncStorage.multiRemove(keys.filter(key => key.startsWith(storagePrefix))))
    .catch(() => {});
}
