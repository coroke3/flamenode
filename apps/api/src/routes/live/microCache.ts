export const ISOLATE_MICRO_CACHE_TTL_MS = 15_000;
export const ISOLATE_MICRO_CACHE_MAX_ENTRIES = 64;
// Upper bound on retained UTF-16 string storage across the 64-entry isolate cache.
// Cache is an optimization; oversize bodies still reach the HTTP caller uncached.
export const ISOLATE_MICRO_CACHE_MAX_BYTES = 8 * 1024 * 1024;

type Entry = { value: string; expiresAt: number };
const entries = new Map<string, Entry>();

function cachedStringBytes(value: string): number {
  // Two bytes per UTF-16 code unit is an upper bound for JS string content.
  return value.length * 2;
}

export function isolateMicroCacheGet(key: string, nowMs: number = Date.now()): string | null {
  const entry = entries.get(key);
  if (!entry) return null;
  // A wall-clock rollback must not extend a private/public snapshot's TTL.
  // The insertion time is recoverable without changing the cache entry shape.
  if (!Number.isFinite(nowMs) || nowMs < entry.expiresAt - ISOLATE_MICRO_CACHE_TTL_MS ||
      nowMs >= entry.expiresAt) {
    entries.delete(key);
    return null;
  }
  // Refresh recency on successful reads: byte-pressure eviction is true LRU,
  // not just insertion-order FIFO. Preserve expiresAt; reads do not extend TTL.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
}

export function isolateMicroCacheSet(key: string, value: string, nowMs: number = Date.now()): void {
  if (typeof value !== "string") {
    throw new TypeError("isolateMicroCache stores finished strings only");
  }
  // NaN would make expiresAt=NaN and bypass every expiry comparison.
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("isolateMicroCache requires a finite timestamp");
  }
  // Cache is best effort: a single huge export must never monopolize isolate memory.
  const incomingBytes = cachedStringBytes(value);
  entries.delete(key);
  if (incomingBytes > ISOLATE_MICRO_CACHE_MAX_BYTES) return;

  // Reclaim expired/clock-rolled-back payloads before enforcing count and bytes.
  let retainedBytes = 0;
  for (const [cachedKey, entry] of entries) {
    if (!Number.isFinite(entry.expiresAt) ||
        nowMs < entry.expiresAt - ISOLATE_MICRO_CACHE_TTL_MS ||
        nowMs >= entry.expiresAt) {
      entries.delete(cachedKey);
      continue;
    }
    retainedBytes += cachedStringBytes(entry.value);
  }
  // Bound combined content size as well as the entry count, evicting LRU-first.
  while (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES ||
         retainedBytes + incomingBytes > ISOLATE_MICRO_CACHE_MAX_BYTES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = entries.get(oldestKey)!;
    retainedBytes -= cachedStringBytes(oldest.value);
    entries.delete(oldestKey);
  }
  entries.set(key, { value, expiresAt: nowMs + ISOLATE_MICRO_CACHE_TTL_MS });
}

/** Remove a cached response immediately when its visibility gate rejects access. */
export function isolateMicroCacheDelete(key: string): void {
  entries.delete(key);
}

export function resetIsolateMicroCacheForTests(): void {
  entries.clear();
}
