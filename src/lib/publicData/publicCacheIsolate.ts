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
export const PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC = 30;

type IsolateJsonCacheEntry = {
  value: unknown;
  expiresAtMs: number;
};

const isolateJsonCache = new Map<string, IsolateJsonCacheEntry>();

function isPromiseLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

export function readPublicJsonIsolateCache(
  r2Key: string,
  nowMs = Date.now(),
): unknown | null {
  const entry = isolateJsonCache.get(r2Key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs || isPromiseLike(entry.value)) {
    isolateJsonCache.delete(r2Key);
    return null;
  }
  isolateJsonCache.delete(r2Key);
  isolateJsonCache.set(r2Key, entry);
  return entry.value;
}

export function writePublicJsonIsolateCache(
  r2Key: string,
  payload: unknown,
  ttlSeconds: number,
  nowMs = Date.now(),
): void {
  if (payload == null || isPromiseLike(payload)) return;
  const ttlSec = Math.min(
    PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
    Math.max(1, Math.floor(ttlSeconds)),
  );
  if (!isolateJsonCache.has(r2Key)) {
    while (isolateJsonCache.size >= PUBLIC_JSON_ISOLATE_CACHE_MAX_ENTRIES) {
      const oldest = isolateJsonCache.keys().next().value;
      if (oldest === undefined) break;
      isolateJsonCache.delete(oldest);
    }
  }
  isolateJsonCache.delete(r2Key);
  isolateJsonCache.set(r2Key, {
    value: payload,
    expiresAtMs: nowMs + ttlSec * 1000,
  });
}

export function deletePublicJsonIsolateCache(r2Key: string): void {
  isolateJsonCache.delete(r2Key);
}

export function resetPublicJsonIsolateCacheForTests(): void {
  isolateJsonCache.clear();
}
