import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  deletePublicJsonIsolateCache,
  PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
  readPublicJsonIsolateCache,
  writePublicJsonIsolateCache,
} from "./publicCacheIsolate";

const CACHE_ORIGIN = "https://flamenode.internal/public-json/";

export type PublicJsonCacheEnvelope = {
  payload: unknown;
  stored_at: number;
};

export function isPublicJsonCacheEnvelope(
  value: unknown,
): value is PublicJsonCacheEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    "payload" in value &&
    typeof (value as PublicJsonCacheEnvelope).stored_at === "number"
  );
}

/** `{ payload, stored_at }` と生 payload の両方を正本 payload へ正規化する。 */
export function unwrapPublicJsonCachePayload<T>(value: unknown): T | null {
  if (value == null) return null;
  if (isPublicJsonCacheEnvelope(value)) {
    return value.payload as T;
  }
  return value as T;
}

/** TTL 付きローダー向けに cache エントリを envelope へ揃える。 */
export function coercePublicJsonCacheEnvelope(
  value: unknown,
  fallbackStoredAt: number,
  options?: { requireStoredAt?: boolean },
): PublicJsonCacheEnvelope | null {
  if (value == null) return null;
  if (isPublicJsonCacheEnvelope(value)) {
    return value;
  }
  // A legacy raw payload has no age metadata. It may still be used by the
  // cache-first compatibility path, but it cannot satisfy a bounded stale
  // fallback after an R2 miss.
  if (options?.requireStoredAt) return null;
  return { payload: value, stored_at: fallbackStoredAt };
}

export function publicJsonCacheKey(r2Key: string): Request {
  return new Request(`${CACHE_ORIGIN}${encodeURIComponent(r2Key)}`);
}

function resolveWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  try {
    const ctx = getCloudflareContext() as {
      ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
    };
    const waitUntil = ctx.ctx?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil.bind(ctx.ctx) : null;
  } catch {
    return null;
  }
}

export async function readPublicJsonCache<T>(r2Key: string): Promise<T | null> {
  const isolated = readPublicJsonIsolateCache(r2Key);
  if (isolated != null) return isolated as T;
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const matched = await cache.match(publicJsonCacheKey(r2Key));
    if (!matched) return null;
    const parsed = (await matched.json()) as T;
    writePublicJsonIsolateCache(
      r2Key,
      parsed,
      PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
    );
    return parsed;
  } catch {
    return null;
  }
}

export function writePublicJsonCacheBestEffort(
  r2Key: string,
  payload: unknown,
  ttlSeconds: number,
): void {
  writePublicJsonIsolateCache(r2Key, payload, ttlSeconds);
  try {
    // Cloudflare requires async work that outlives the response to be awaited
    // or registered with waitUntil. Resolve the execution context before
    // starting Cache API I/O so a missing/local shim never creates a floating
    // cache.put Promise that can be dropped or leak across request lifetimes.
    const waitUntil = resolveWaitUntil();
    if (!waitUntil) return;

    const safeTtl = Math.max(1, Math.floor(ttlSeconds));
    const putPromise = (caches as unknown as { default: Cache }).default.put(
      publicJsonCacheKey(r2Key),
      new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${safeTtl}`,
        },
      }),
    );
    waitUntil(putPromise.catch(() => undefined));
  } catch {
    // Cache API failure must not take down the page.
  }
}

export async function deletePublicJsonCache(r2Key: string): Promise<void> {
  deletePublicJsonIsolateCache(r2Key);
  try {
    await (caches as unknown as { default: Cache }).default.delete(
      publicJsonCacheKey(r2Key),
    );
  } catch {
    // Cache API failure must not take down the mutation path.
  }
}

export async function deletePublicJsonCaches(r2Keys: readonly string[]): Promise<void> {
  for (const key of r2Keys) {
    await deletePublicJsonCache(key);
  }
}
