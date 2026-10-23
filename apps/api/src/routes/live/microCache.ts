export const ISOLATE_MICRO_CACHE_TTL_MS = 15_000;
export const ISOLATE_MICRO_CACHE_MAX_ENTRIES = 64;

type Entry = { value: string; expiresAt: number };
const entries = new Map<string, Entry>();

export function isolateMicroCacheGet(key: string, nowMs: number = Date.now()): string | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (nowMs >= entry.expiresAt) {
    entries.delete(key);
    return null;
  }
  return entry.value;
}

export function isolateMicroCacheSet(key: string, value: string, nowMs: number = Date.now()): void {
  if (typeof value !== "string") {
    throw new TypeError("isolateMicroCache stores finished strings only");
  }
  entries.delete(key);
  if (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES) {
    for (const [k, e] of entries) {
      if (nowMs >= e.expiresAt) entries.delete(k);
    }
    while (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }
  entries.set(key, { value, expiresAt: nowMs + ISOLATE_MICRO_CACHE_TTL_MS });
}

export function resetIsolateMicroCacheForTests(): void {
  entries.clear();
}
