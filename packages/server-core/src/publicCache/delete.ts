import type { EdgeCachePort } from "../ports.ts";

const CACHE_ORIGIN = "https://flamenode.internal/public-json/";

/** Cache API key URL of a public JSON entry. Reads, writes and deletes must agree on it. */
export function publicJsonCacheUrl(r2Key: string): string {
  return `${CACHE_ORIGIN}${encodeURIComponent(r2Key)}`;
}

/**
 * What the delete path needs from its host. The isolate-local map stays with the host module
 * (one instance per isolate); the Cache API is read lazily so a missing `caches` global is caught
 * here like any other Cache API failure.
 */
export type PublicJsonCacheDeleteHost = {
  dropIsolateEntry(r2Key: string): void;
  readEdgeCache(): EdgeCachePort;
};

export async function deletePublicJsonCache(
  r2Key: string,
  host: PublicJsonCacheDeleteHost,
): Promise<void> {
  host.dropIsolateEntry(r2Key);
  try {
    await host.readEdgeCache().delete(publicJsonCacheUrl(r2Key));
  } catch {
    // Cache API failure must not take down the mutation path. Key は出さない。
    console.warn("[public-cache] cache_api_delete_failed");
  }
}

export async function deletePublicJsonCaches(
  r2Keys: readonly string[],
  host: PublicJsonCacheDeleteHost,
): Promise<void> {
  for (const key of r2Keys) {
    await deletePublicJsonCache(key, host);
  }
}
