import "server-only";

/**
 * Isolate-local parsed public JSON. Holds plain objects only (no bindings,
 * no Promises) so a warm Worker can skip Cache API / R2 JSON.parse on repeat
 * public GETs. Bounded size + TTL so withdrawn artifacts do not stick forever.
 *
 * Official Workers CPU: I/O is not billed; JSON.parse and SSR are.
 * https://developers.cloudflare.com/workers/platform/limits/
 */
export const PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES = 24;
export const PUBLIC_JSON_ISOLATE_CACHE_MAX_BYTES = 1_048_576;
export const PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRY_BYTES = 131_072;
export const PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC = 30;

type IsolateJsonCacheEntry = {
  value: unknown;
  expiresAtMs: number;
  byteWeight: number;
};

const isolateJsonCache = new Map<string, IsolateJsonCacheEntry>();
let isolateJsonCacheBytes = 0;

function isPromiseLike(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

function deleteEntry(r2Key: string): void {
  const entry = isolateJsonCache.get(r2Key);
  if (!entry) return;
  isolateJsonCache.delete(r2Key);
  isolateJsonCacheBytes = Math.max(0, isolateJsonCacheBytes - entry.byteWeight);
}

function pruneExpiredEntries(nowMs: number): void {
  for (const [r2Key, entry] of isolateJsonCache) {
    if (entry.expiresAtMs <= nowMs || isPromiseLike(entry.value)) {
      deleteEntry(r2Key);
    }
  }
}

function evictOldestEntry(): void {
  const oldest = isolateJsonCache.keys().next().value;
  if (oldest !== undefined) deleteEntry(oldest);
}

export function readPublicJsonIsolateCache(
  r2Key: string,
  nowMs = Date.now(),
): unknown | null {
  // Only non-negative whole-millisecond timestamps are valid. A fractional,
  // negative or unsafe clock must not read data or refresh its LRU position.
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  pruneExpiredEntries(nowMs);
  const entry = isolateJsonCache.get(r2Key);
  if (!entry) return null;
  deleteEntry(r2Key);
  isolateJsonCache.set(r2Key, entry);
  isolateJsonCacheBytes += entry.byteWeight;
  return entry.value;
}

export function writePublicJsonIsolateCache(
  r2Key: string,
  payload: unknown,
  ttlSeconds: number,
  byteWeight: number,
  nowMs = Date.now(),
): void {
  // A rejected replacement must not leave the previous value readable.
  // In particular, an invalidated snapshot may now be null or async.
  if (payload == null || isPromiseLike(payload)) {
    deleteEntry(r2Key);
    return;
  }
  // NaN comparison is always false; a cached entry with NaN expiration would never expire.
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    deleteEntry(r2Key);
    return;
  }
  pruneExpiredEntries(nowMs);
  // Byte accounting must use an exact non-negative integer, not a rounded
  // caller-supplied weight that can undercount per-entry and total budgets.
  if (
    !Number.isSafeInteger(byteWeight) ||
    byteWeight <= 0 ||
    byteWeight > PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRY_BYTES
  ) {
    deleteEntry(r2Key);
    return;
  }
  // Direct callers must not create an entry with expiresAtMs=NaN/Infinity:
  // such an entry would never satisfy the expiry comparison during pruning.
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    deleteEntry(r2Key);
    return;
  }
  const ttlSec = Math.min(
    PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
    Math.max(1, Math.floor(ttlSeconds)),
  );
  const expiresAtMs = nowMs + ttlSec * 1000;
  // Reject timestamps whose expiry overflows the safe integer range; otherwise
  // a rounded/Infinity deadline could outlive the intended bounded TTL.
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(expiresAtMs)) {
    deleteEntry(r2Key);
    return;
  }
  deleteEntry(r2Key);
  while (
    isolateJsonCache.size >= PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES ||
    isolateJsonCacheBytes + byteWeight > PUBLIC_JSON_ISOLATE_CACHE_MAX_BYTES
  ) {
    if (isolateJsonCache.size === 0) return;
    evictOldestEntry();
  }
  isolateJsonCache.set(r2Key, {
    value: payload,
    expiresAtMs,
    byteWeight,
  });
  isolateJsonCacheBytes += byteWeight;
}

export function deletePublicJsonIsolateCache(r2Key: string): void {
  deleteEntry(r2Key);
}

export function resetPublicJsonIsolateCacheForTests(): void {
  isolateJsonCache.clear();
  isolateJsonCacheBytes = 0;
}
