import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

const CACHE_ORIGIN = "https://flamenode.internal/public-json/";
export const PUBLIC_JSON_CACHE_MAX_BYTES = 16 * 1024 * 1024;

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

function contentLengthBytes(response: Response): number | null {
  const raw = response.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function cancelResponseBodyBestEffort(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cache entry is ignored regardless of cleanup result.
  }
}

/**
 * Cache API entry はアプリが書いたJSONだが、古い/破損entryを無制限に
 * `Response.json()` すると巨大objectのparseでWorker CPU/heapを消費し得る。
 * Content-Length が使える場合はbuffer前に拒否し、最終的にもbyteLengthで上限を固定する。
 */
async function readBoundedJsonResponse<T>(response: Response): Promise<T | null> {
  const declaredBytes = contentLengthBytes(response);
  if (declaredBytes !== null && declaredBytes > PUBLIC_JSON_CACHE_MAX_BYTES) {
    await cancelResponseBodyBestEffort(response);
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > PUBLIC_JSON_CACHE_MAX_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export async function readPublicJsonCache<T>(r2Key: string): Promise<T | null> {
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const matched = await cache.match(publicJsonCacheKey(r2Key));
    if (!matched) return null;
    return await readBoundedJsonResponse<T>(matched);
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
    // Cloudflare requires async work that outlives the response to be awaited
    // or registered with waitUntil. Resolve the execution context before
    // starting Cache API I/O so a missing/local shim never creates a floating
    // cache.put Promise that can be dropped or leak across request lifetimes.
    const waitUntil = resolveWaitUntil();
    if (!waitUntil) return;

    const safeTtl = Math.max(1, Math.floor(ttlSeconds));
    const serialized = JSON.stringify(payload);
    // Cache miss/R2 hit時だけ通るbackground write。UTF-8 byte数でreaderと同じ上限を
    // 適用し、multi-byte payloadがoversized entryを作らないようにする。
    if (new TextEncoder().encode(serialized).byteLength > PUBLIC_JSON_CACHE_MAX_BYTES) {
      return;
    }
    const putPromise = (caches as unknown as { default: Cache }).default.put(
      publicJsonCacheKey(r2Key),
      new Response(serialized, {
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
