import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

const CACHE_ORIGIN = "https://flamenode.internal/public-json/";

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
