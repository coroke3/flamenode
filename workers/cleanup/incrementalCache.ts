/** Only disposable OpenNext cache objects are eligible; never application R2 data. */
export const INCREMENTAL_CACHE_PREFIX = "incremental-cache/";
export const INCREMENTAL_CACHE_RETENTION_MS = 30 * 86400 * 1000;
export const INCREMENTAL_CACHE_SCAN_LIMIT = 200;
export const INCREMENTAL_CACHE_SCAN_INTERVAL_MS = 86400 * 1000;
export const INCREMENTAL_CACHE_SCAN_STATE_KEY = "cleanup:incremental-cache:v1";

const CACHE_KEY = /^incremental-cache\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\.(?:cache|fetch)$/;

type CacheCleanupEnv = {
  R2: Pick<R2Bucket, "list" | "delete">;
  KV: Pick<KVNamespace, "get" | "put">;
};

export type CacheCleanupResult = {
  scanned: number;
  deleted: number;
  bytesDeleted: number;
  hasMore: boolean;
  skipped: boolean;
};

/**
 * One bounded page per Recovery Cron, without reading D1 or downloading bodies.
 * A completed scan sleeps for a day. Truncated scans resume next Cron, even when
 * R2 returned fewer objects than requested. Delete failure never advances state.
 * Expired cache misses are rebuilt by OpenNext using the existing data loaders.
 */
export async function cleanupIncrementalCache(
  env: CacheCleanupEnv,
  signal?: AbortSignal,
  nowMs = Date.now(),
): Promise<CacheCleanupResult> {
  signal?.throwIfAborted();
  const state = await env.KV.get<{
    cursor?: string;
    nextScanAt?: number;
  }>(INCREMENTAL_CACHE_SCAN_STATE_KEY, "json");
  signal?.throwIfAborted();
  if (
    typeof state?.nextScanAt === "number" &&
    state.nextScanAt > nowMs &&
    state.nextScanAt <= nowMs + INCREMENTAL_CACHE_SCAN_INTERVAL_MS
  ) {
    return { scanned: 0, deleted: 0, bytesDeleted: 0, hasMore: false, skipped: true };
  }
  const cursor = typeof state?.cursor === "string" && state.cursor.length > 0
    ? state.cursor
    : undefined;
  const page = await env.R2.list({
    prefix: INCREMENTAL_CACHE_PREFIX,
    limit: INCREMENTAL_CACHE_SCAN_LIMIT,
    ...(cursor ? { cursor } : {}),
  });
  signal?.throwIfAborted();
  if (page.truncated && !page.cursor) {
    throw new Error("incremental_cache_cleanup_missing_cursor");
  }
  const expired = page.objects.filter((object) =>
    CACHE_KEY.test(object.key) &&
    Number.isFinite(object.uploaded.getTime()) &&
    object.uploaded.getTime() < nowMs - INCREMENTAL_CACHE_RETENTION_MS,
  );
  if (expired.length > 0) {
    await env.R2.delete(expired.map((object) => object.key));
    signal?.throwIfAborted();
  }
  await env.KV.put(
    INCREMENTAL_CACHE_SCAN_STATE_KEY,
    JSON.stringify(page.truncated
      ? { cursor: page.cursor }
      : { nextScanAt: nowMs + INCREMENTAL_CACHE_SCAN_INTERVAL_MS }),
  );
  return {
    scanned: page.objects.length,
    deleted: expired.length,
    bytesDeleted: expired.reduce((sum, object) => sum + object.size, 0),
    hasMore: page.truncated,
    skipped: false,
  };
}
