import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  deletePublicJsonIsolateCache,
  PUBLIC_JSON_ISOLATE_CACHE_MAX_TTL_SEC,
  readPublicJsonIsolateCache,
  writePublicJsonIsolateCache,
} from "./publicCacheIsolate";

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

function utf8ByteLengthExceeds(value: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD (3 bytes).
        bytes += 3;
      }
    } else {
      // BMP characters and lone low surrogates both encode to at most 3 bytes.
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
}

async function readResponseBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const body = response.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Cache API entry はアプリが書いたJSONだが、古い/破損entryを無制限に
 * `Response.json()` すると巨大objectのparseでWorker CPU/heapを消費し得る。
 * Content-Length が使える場合はstream前に拒否し、欠けていてもmax+1 byteを
 * 読んだ時点で中断するため、巨大entry全体をbufferしない。
 */
async function readBoundedJsonResponse<T>(response: Response): Promise<T | null> {
  const declaredBytes = contentLengthBytes(response);
  if (declaredBytes !== null && declaredBytes > PUBLIC_JSON_CACHE_MAX_BYTES) {
    await cancelResponseBodyBestEffort(response);
    return null;
  }
  const bytes = await readResponseBodyBounded(response, PUBLIC_JSON_CACHE_MAX_BYTES);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
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
    const parsed = await readBoundedJsonResponse<T>(matched);
    if (parsed == null) return null;
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
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== "string") return;
    // Cache miss/R2 hit時だけ通るbackground write。readerと同じUTF-8 byte上限を
    // allocation-freeに数え、巨大entryをCache APIへ渡さない。
    if (utf8ByteLengthExceeds(serialized, PUBLIC_JSON_CACHE_MAX_BYTES)) return;
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
