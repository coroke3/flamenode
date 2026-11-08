import { publicJsonCacheUrl } from "./delete.ts";

/**
 * Cache API host supplied by Next/Hono, never ambiently acquired by server-core.
 * Export payload cache is 16 MiB bounded, matching CURRENT publicCache.ts.
 */
export const PUBLIC_JSON_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export type PublicJsonCachePort = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<unknown>;
  delete(request: Request): Promise<boolean>;
};
export type PublicJsonCacheHost = {
  cache: PublicJsonCachePort;
  waitUntil?: (pending: Promise<unknown>) => void;
};
export type PublicJsonCacheEnvelope<T> = { payload: T; stored_at: number };

export function coercePublicJsonCacheEnvelope<T>(
  value: unknown,
  fallbackStoredAt: number,
  options?: { requireStoredAt?: boolean },
): PublicJsonCacheEnvelope<T> | null {
  if (value == null) return null;
  if (typeof value === "object" && "payload" in value && typeof (value as { stored_at?: unknown }).stored_at === "number") {
    return value as PublicJsonCacheEnvelope<T>;
  }
  if (options?.requireStoredAt) return null;
  return { payload: value as T, stored_at: fallbackStoredAt };
}

function jsonCacheRequest(key: string): Request {
  return new Request(publicJsonCacheUrl(key));
}

async function boundedBody(response: Response): Promise<string | null> {
  const rawSize = response.headers.get("content-length");
  if (rawSize && /^\d+$/.test(rawSize) && Number(rawSize) > PUBLIC_JSON_CACHE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      byteLength += value.byteLength;
      if (byteLength > PUBLIC_JSON_CACHE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readPublicJsonCache<T>(key: string, host: PublicJsonCacheHost): Promise<T | null> {
  try {
    const found = await host.cache.match(jsonCacheRequest(key));
    if (!found) return null;
    const body = await boundedBody(found);
    if (body == null) return null;
    const value: unknown = JSON.parse(body);
    return value == null ? null : value as T;
  } catch {
    return null;
  }
}

export function writePublicJsonCacheBestEffort(
  key: string,
  payload: unknown,
  ttlSeconds: number,
  host: PublicJsonCacheHost,
): void {
  try {
    // Missing waitUntil is a no-op; no untracked Cache.put Promise is created.
    if (!host.waitUntil) return;
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== "string") return;
    if (new TextEncoder().encode(serialized).byteLength > PUBLIC_JSON_CACHE_MAX_BYTES) return;
    const ttl = Math.max(1, Math.floor(ttlSeconds));
    const put = host.cache.put(jsonCacheRequest(key), new Response(serialized, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
    }));
    host.waitUntil(put.catch(() => undefined));
  } catch {
    // Cache API failures do not take down an otherwise valid public export.
  }
}

export async function deletePublicJsonCacheBestEffort(key: string, host: PublicJsonCacheHost): Promise<void> {
  try {
    await host.cache.delete(jsonCacheRequest(key));
  } catch {
    console.warn("[public-cache] cache_api_delete_failed");
  }
}
