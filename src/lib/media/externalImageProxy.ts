type ImageCacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  etag?: string;
  expiresAt: number;
  staleUntil: number;
};

type FailureCacheEntry = {
  status: number;
  expiresAt: number;
};

type ProxyStore = {
  images: Map<string, ImageCacheEntry>;
  failures: Map<string, FailureCacheEntry>;
  inFlight: Map<string, Promise<RefreshResult>>;
  totalBytes: number;
};

type RefreshResult =
  | { kind: "image"; entry: ImageCacheEntry; state: "miss" | "stale" }
  | { kind: "failure"; status: number | null };

export type ExternalImageProxyOptions = {
  namespace: string;
  cacheKey: string;
  upstreamUrl: string;
  fallbackSvg: string;
  defaultContentType?: string;
  successTtlMs?: number;
  failureTtlMs?: number;
  staleTtlMs?: number;
  fetchTimeoutMs?: number;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  maxObjectBytes?: number;
  maxRetryAfterMs?: number;
};

const DEFAULT_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_FAILURE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_STALE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CACHE_ENTRIES = 600;
const DEFAULT_MAX_CACHE_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RETRY_AFTER_MS = 60 * 60 * 1_000;

// The proxy is used by <img> tags, but the endpoint can also be opened
// directly.  Do not reflect an upstream SVG (or an unlabelled body) as an
// image: an SVG can carry active content when it is navigated directly, and a
// missing content type would otherwise make arbitrary bytes look like JPEG.
const SAFE_EXTERNAL_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const globalState = globalThis as typeof globalThis & {
  __flamenodeExternalImageProxyStores?: Map<string, ProxyStore>;
};
const stores =
  globalState.__flamenodeExternalImageProxyStores ?? new Map<string, ProxyStore>();
globalState.__flamenodeExternalImageProxyStores = stores;

function storeFor(namespace: string): ProxyStore {
  const existing = stores.get(namespace);
  if (existing) return existing;
  const created: ProxyStore = {
    images: new Map(),
    failures: new Map(),
    inFlight: new Map(),
    totalBytes: 0,
  };
  stores.set(namespace, created);
  return created;
}

export function parseExternalRetryAfterMs(
  value: string | null,
  maxDelayMs = DEFAULT_MAX_RETRY_AFTER_MS,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const cap = Math.max(0, Math.floor(maxDelayMs));
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(cap, seconds * 1_000);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(cap, Math.max(0, timestamp - now));
}

function touchImage(store: ProxyStore, key: string, entry: ImageCacheEntry): void {
  store.images.delete(key);
  store.images.set(key, entry);
}

function pruneFailures(store: ProxyStore, maxEntries: number): void {
  while (store.failures.size > maxEntries) {
    const first = store.failures.keys().next().value as string | undefined;
    if (!first) return;
    store.failures.delete(first);
  }
}

function pruneImages(
  store: ProxyStore,
  maxEntries: number,
  maxBytes: number,
): void {
  while (store.images.size > maxEntries || store.totalBytes > maxBytes) {
    const first = store.images.entries().next().value as
      | [string, ImageCacheEntry]
      | undefined;
    if (!first) {
      store.totalBytes = 0;
      return;
    }
    store.images.delete(first[0]);
    store.totalBytes = Math.max(0, store.totalBytes - first[1].bytes.byteLength);
  }
}

function storeImage(
  store: ProxyStore,
  key: string,
  entry: ImageCacheEntry,
  maxEntries: number,
  maxBytes: number,
): void {
  const previous = store.images.get(key);
  if (previous) store.totalBytes -= previous.bytes.byteLength;
  store.images.delete(key);
  store.images.set(key, entry);
  store.totalBytes += entry.bytes.byteLength;
  pruneImages(store, maxEntries, maxBytes);
}

function imageResponse(
  entry: ImageCacheEntry,
  cacheState: "hit" | "miss" | "stale" | "coalesced",
): Response {
  const headers = new Headers({
    "cache-control":
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
    "content-type": entry.contentType,
    "x-content-type-options": "nosniff",
    "x-fn-media-cache": cacheState,
  });
  if (entry.etag) headers.set("etag", entry.etag);
  return new Response(entry.bytes.slice(), { headers });
}

function fallbackResponse(
  fallbackSvg: string,
  status: number | null,
  cacheState = "fallback",
): Response {
  const headers = new Headers({
    "cache-control": "public, max-age=300, s-maxage=600",
    "content-type": "image/svg+xml; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-fn-media-cache": cacheState,
  });
  if (status != null) headers.set("x-fn-upstream-status", String(status));
  return new Response(fallbackSvg, { headers });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // best effort
  }
}

function normalizeExternalImageContentType(
  value: string | null,
): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return SAFE_EXTERNAL_IMAGE_CONTENT_TYPES.has(normalized) ? normalized : null;
}

type ReadBodyResult =
  | { bytes: Uint8Array; tooLarge: false }
  | { bytes: null; tooLarge: true };

/** Read an upstream body without ever buffering more than maxObjectBytes. */
async function readBodyUpToLimit(
  response: Response,
  maxObjectBytes: number,
  timeoutMs: number,
): Promise<ReadBodyResult> {
  const body = response.body;
  if (!body) {
    const timeout = Math.max(1, Math.floor(timeoutMs));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buffer = await Promise.race([
      response.arrayBuffer(),
      new Promise<ArrayBuffer>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("external_image_body_timeout")),
          timeout,
        );
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (buffer.byteLength > maxObjectBytes) {
      return { bytes: null, tooLarge: true };
    }
    return { bytes: new Uint8Array(buffer), tooLarge: false };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const read = (async (): Promise<ReadBodyResult> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        total += value.byteLength;
        if (total > maxObjectBytes) {
          await reader.cancel();
          return { bytes: null, tooLarge: true };
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
    return { bytes, tooLarge: false };
  })();
  const timeout = Math.max(1, Math.floor(timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<ReadBodyResult>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel();
          reject(new Error("external_image_body_timeout"));
        }, timeout);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  etag?: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const headers = new Headers();
    if (etag) headers.set("if-none-match", etag);
    return await fetch(url, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshImage(
  store: ProxyStore,
  options: Required<
    Pick<
      ExternalImageProxyOptions,
      | "cacheKey"
      | "upstreamUrl"
      | "fallbackSvg"
      | "defaultContentType"
      | "successTtlMs"
      | "failureTtlMs"
      | "staleTtlMs"
      | "fetchTimeoutMs"
      | "maxCacheEntries"
      | "maxCacheBytes"
      | "maxObjectBytes"
      | "maxRetryAfterMs"
    >
  >,
  cached: ImageCacheEntry | undefined,
  now: number,
): Promise<RefreshResult> {
  try {
    const upstream = await fetchWithTimeout(
      options.upstreamUrl,
      options.fetchTimeoutMs,
      cached?.etag,
    );

    if (upstream.status === 304 && cached) {
      const refreshed: ImageCacheEntry = {
        ...cached,
        expiresAt: now + options.successTtlMs,
        staleUntil: now + options.staleTtlMs,
      };
      touchImage(store, options.cacheKey, refreshed);
      store.failures.delete(options.cacheKey);
      await cancelBody(upstream);
      return { kind: "image", entry: refreshed, state: "miss" };
    }

    const contentType = normalizeExternalImageContentType(
      upstream.headers.get("content-type"),
    );
    const contentLength = Number(upstream.headers.get("content-length"));
    if (
      !upstream.ok ||
      !contentType ||
      (Number.isFinite(contentLength) && contentLength > options.maxObjectBytes)
    ) {
      const retryAfter = parseExternalRetryAfterMs(
        upstream.headers.get("retry-after"),
        options.maxRetryAfterMs,
        now,
      );
      const status =
        Number.isFinite(contentLength) && contentLength > options.maxObjectBytes
          ? 413
          : upstream.status;
      store.failures.set(options.cacheKey, {
        status,
        expiresAt: now + Math.max(options.failureTtlMs, retryAfter ?? 0),
      });
      pruneFailures(store, options.maxCacheEntries);
      await cancelBody(upstream);
      if (cached && cached.staleUntil > now) {
        return { kind: "image", entry: cached, state: "stale" };
      }
      return { kind: "failure", status };
    }

    const body = await readBodyUpToLimit(
      upstream,
      options.maxObjectBytes,
      options.fetchTimeoutMs,
    );
    if (body.tooLarge) {
      store.failures.set(options.cacheKey, {
        status: 413,
        expiresAt: now + options.failureTtlMs,
      });
      pruneFailures(store, options.maxCacheEntries);
      if (cached && cached.staleUntil > now) {
        return { kind: "image", entry: cached, state: "stale" };
      }
      return { kind: "failure", status: 413 };
    }

    const entry: ImageCacheEntry = {
      bytes: body.bytes,
      contentType,
      etag: upstream.headers.get("etag") ?? cached?.etag,
      expiresAt: now + options.successTtlMs,
      staleUntil: now + options.staleTtlMs,
    };
    storeImage(
      store,
      options.cacheKey,
      entry,
      options.maxCacheEntries,
      options.maxCacheBytes,
    );
    store.failures.delete(options.cacheKey);
    return { kind: "image", entry, state: "miss" };
  } catch {
    store.failures.set(options.cacheKey, {
      status: 0,
      expiresAt: now + options.failureTtlMs,
    });
    pruneFailures(store, options.maxCacheEntries);
    if (cached && cached.staleUntil > now) {
      return { kind: "image", entry: cached, state: "stale" };
    }
    return { kind: "failure", status: null };
  }
}

export async function proxyExternalImage(
  rawOptions: ExternalImageProxyOptions,
): Promise<Response> {
  const options = {
    ...rawOptions,
    defaultContentType: rawOptions.defaultContentType ?? "image/jpeg",
    successTtlMs: rawOptions.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS,
    failureTtlMs: rawOptions.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS,
    staleTtlMs: rawOptions.staleTtlMs ?? DEFAULT_STALE_TTL_MS,
    fetchTimeoutMs: rawOptions.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    maxCacheEntries: rawOptions.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
    maxCacheBytes: rawOptions.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES,
    maxObjectBytes: rawOptions.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES,
    maxRetryAfterMs: rawOptions.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS,
  };
  const store = storeFor(options.namespace);
  const now = Date.now();
  const cached = store.images.get(options.cacheKey);
  if (cached && cached.expiresAt > now) {
    touchImage(store, options.cacheKey, cached);
    return imageResponse(cached, "hit");
  }

  const failure = store.failures.get(options.cacheKey);
  if (failure && failure.expiresAt > now) {
    if (cached && cached.staleUntil > now) {
      return imageResponse(cached, "stale");
    }
    return fallbackResponse(options.fallbackSvg, failure.status);
  }
  if (failure) store.failures.delete(options.cacheKey);

  const existing = store.inFlight.get(options.cacheKey);
  const joined = Boolean(existing);
  const pending =
    existing ??
    refreshImage(store, options, cached, now).finally(() => {
      store.inFlight.delete(options.cacheKey);
    });
  if (!existing) store.inFlight.set(options.cacheKey, pending);

  const result = await pending;
  if (result.kind === "image") {
    return imageResponse(result.entry, joined && result.state === "miss" ? "coalesced" : result.state);
  }
  return fallbackResponse(options.fallbackSvg, result.status);
}
