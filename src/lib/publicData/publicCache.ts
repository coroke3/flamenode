import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

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
): PublicJsonCacheEnvelope | null {
  if (value == null) return null;
  if (isPublicJsonCacheEnvelope(value)) {
    return value;
  }
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
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const matched = await cache.match(publicJsonCacheKey(r2Key));
    if (!matched) return null;
    return (await matched.json()) as T;
  } catch {
    return null;
  }
}

export function writePublicJsonCacheBestEffort(
  r2Key: string,
  payload: unknown,
  ttlSeconds: number,
): void {
  try {
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
    const waitUntil = resolveWaitUntil();
    if (waitUntil) {
      waitUntil(putPromise.catch(() => undefined));
      return;
    }
    void putPromise.catch(() => undefined);
  } catch {
    // Cache API failure must not take down the page.
  }
}

export async function deletePublicJsonCache(r2Key: string): Promise<void> {
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
