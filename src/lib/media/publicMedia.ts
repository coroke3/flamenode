import type { FlameNodeEnv } from "@/lib/cloudflare";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cancelR2BodyBestEffort } from "../r2Body.ts";
import { safeErrorSummary } from "../../../workers/shared/safeLog.ts";

function safePublicErrorSummary(error: unknown): string {
  return safeErrorSummary(error)
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /\b(?:select|insert|update|delete|pragma|from|where)\b[\s\S]*/gi,
      "[REDACTED_SQL]",
    );
}

export const MAX_PUBLIC_MEDIA_BYTES = 5 * 1024 * 1024;
/**
 * 公開メディア画像はエッジおよびブラウザで効率的にキャッシュし、D1/R2リクエストを抑制する。
 */
export const PUBLIC_MEDIA_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

const PUBLIC_MEDIA_NAMESPACES = [
  "video-icons",
  "xicons",
  "x-icons",
  "event-icons",
  "event-banners",
] as const;

export type PublicMediaNamespace = (typeof PUBLIC_MEDIA_NAMESPACES)[number];

const ALLOWED_PUBLIC_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MEDIA_UNAVAILABLE_HEADERS = {
  "cache-control": "no-store",
  "retry-after": "30",
};

function mediaUnavailableResponse(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: MEDIA_UNAVAILABLE_HEADERS,
  });
}

export function getPublicMediaNamespace(key: string): PublicMediaNamespace | null {
  const separator = key.indexOf("/");
  if (separator <= 0 || separator === key.length - 1) return null;
  const namespace = key.slice(0, separator);
  return (PUBLIC_MEDIA_NAMESPACES as readonly string[]).includes(namespace)
    ? (namespace as PublicMediaNamespace)
    : null;
}

export function isValidPublicMediaKey(rawKey: string): boolean {
  return Boolean(
    rawKey &&
      !rawKey.includes("..") &&
      !rawKey.includes("\\") &&
      !/[\x00-\x1F\x7F]/.test(rawKey) &&
      getPublicMediaNamespace(rawKey),
  );
}

export function normalizePublicMediaContentType(
  contentType: string | null | undefined,
): string | null {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_PUBLIC_MEDIA_TYPES.has(normalized) ? normalized : null;
}

export function isPublicMediaObjectSafe(input: {
  size: number;
  contentType: string | null | undefined;
}): boolean {
  return (
    Number.isSafeInteger(input.size) &&
    input.size > 0 &&
    input.size <= MAX_PUBLIC_MEDIA_BYTES &&
    normalizePublicMediaContentType(input.contentType) !== null
  );
}

/**
 * 1リクエスト1queryで、R2 keyがD1上の公開entityに正確に紐付くことを確認する。
 * static_artifactsは明示的なpublic_media行だけを許可し、削除済み行は許可しない。
 */
export const PUBLIC_MEDIA_ACCESS_SQL = `
SELECT 1 AS allowed
WHERE EXISTS (
  SELECT 1 FROM static_artifacts sa
  WHERE sa.object_key = ?1
    AND sa.target_type = 'public_media'
    AND sa.deleted_at IS NULL
)
OR (
  ?2 IN ('video-icons', 'xicons', 'x-icons')
  AND (
    EXISTS (
      SELECT 1 FROM x_users xu
      WHERE xu.icon_url = ?3 AND xu.approval_status = 'approved'
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.creator_icon_url = ?3
        AND v.visibility_status = 'public'
      LIMIT 1
    )
  )
)
OR (
  ?2 IN ('event-icons', 'event-banners')
  AND (
    EXISTS (
      SELECT 1 FROM events e
      WHERE (e.icon_url = ?3 OR e.img_url = ?3)
        AND e.visibility_status = 'public'
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM event_groups eg
      WHERE (eg.icon_url = ?3 OR eg.img_url = ?3)
        AND eg.visibility_status IN ('public', 'archived')
      LIMIT 1
    )
  )
)
LIMIT 1
`;

function getEdgeCache(): Cache | null {
  try {
    if (typeof caches !== "undefined" && "default" in caches) {
      return (caches as unknown as { default: Cache }).default ?? null;
    }
    return null;
  } catch {
    return null;
  }
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

function getMediaCacheKey(
  request: Request | undefined,
  rawKey: string,
): Request | null {
  if (!request) return null;
  try {
    const url = new URL(request.url);
    // Keep the request's real zone hostname, but drop cache-buster query strings.
    const encodedKey = rawKey.split("/").map(encodeURIComponent).join("/");
    const normalizedUrl = `${url.origin}/api/media/${encodedKey}`;
    return new Request(normalizedUrl, { method: "GET" });
  } catch {
    return null;
  }
}

type MediaAccessCacheEntry = {
  allowed: boolean;
  expiresAt: number;
};

const ACCESS_CHECK_CACHE_MAX_ENTRIES = 2_000;
const ACCESS_CHECK_CACHE_TTL_MS = 10 * 60 * 1_000;
const ACCESS_CHECK_NEGATIVE_CACHE_TTL_MS = 60 * 1_000;

const globalState = globalThis as typeof globalThis & {
  __flamenodePublicMediaAccessCache?: Map<string, MediaAccessCacheEntry>;
};
const accessCache =
  globalState.__flamenodePublicMediaAccessCache ?? new Map<string, MediaAccessCacheEntry>();
globalState.__flamenodePublicMediaAccessCache = accessCache;

export function clearPublicMediaAccessCacheForTest(): void {
  accessCache.clear();
}

function getCachedAccess(rawKey: string, now: number): boolean | null {
  const entry = accessCache.get(rawKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    accessCache.delete(rawKey);
    return null;
  }
  return entry.allowed;
}

function setCachedAccess(rawKey: string, allowed: boolean, now: number): void {
  while (accessCache.size >= ACCESS_CHECK_CACHE_MAX_ENTRIES) {
    const firstKey = accessCache.keys().next().value;
    if (!firstKey) break;
    accessCache.delete(firstKey);
  }
  const ttl = allowed ? ACCESS_CHECK_CACHE_TTL_MS : ACCESS_CHECK_NEGATIVE_CACHE_TTL_MS;
  accessCache.set(rawKey, { allowed, expiresAt: now + ttl });
}

/** Cache API hitはCloudflare binding取得やD1/R2照合より前に返す。 */
export async function getCachedPublicMediaResponse(
  request: Request,
  rawKey: string,
): Promise<Response | null> {
  if (!isValidPublicMediaKey(rawKey)) return null;
  const cache = getEdgeCache();
  const cacheKey = getMediaCacheKey(request, rawKey);
  if (!cache || !cacheKey) return null;

  try {
    const cached = await cache.match(cacheKey);
    if (!cached) return null;
    const ifNoneMatch = request.headers.get("If-None-Match");
    const cachedEtag = cached.headers.get("etag");
    if (
      ifNoneMatch &&
      cachedEtag &&
      ifNoneMatch.split(",").some((candidate) => {
        const normalized = candidate.trim();
        return (
          normalized === "*" ||
          normalized.replace(/^W\//, "") === cachedEtag.replace(/^W\//, "")
        );
      })
    ) {
      return new Response(null, {
        status: 304,
        headers: new Headers(cached.headers),
      });
    }
    return cached;
  } catch {
    // Cache miss / lookup error, continue to D1/R2 on the origin path.
    return null;
  }
}

export async function servePublicMedia(
  env: Pick<FlameNodeEnv, "DB" | "BUCKET">,
  rawKey: string,
  request?: Request,
  options?: { skipEdgeCacheLookup?: boolean },
): Promise<Response> {
  if (!isValidPublicMediaKey(rawKey)) return new Response("Not found", { status: 404 });

  const namespace = getPublicMediaNamespace(rawKey)!;

  const ifNoneMatch = request?.headers.get("If-None-Match");
  const cache = getEdgeCache();
  const cacheKey = getMediaCacheKey(request, rawKey);

  if (request && !options?.skipEdgeCacheLookup) {
    const cached = await getCachedPublicMediaResponse(request, rawKey);
    if (cached) return cached;
  }

  const now = Date.now();
  let isAllowed = getCachedAccess(rawKey, now);

  if (isAllowed === null) {
    const publicUrl = `/api/media/${rawKey}`;
    let allowed: { allowed: number } | null = null;
    try {
      allowed = await env.DB.prepare(PUBLIC_MEDIA_ACCESS_SQL)
        .bind(rawKey, namespace, publicUrl)
        .first<{ allowed: number }>();
    } catch (error) {
      console.error(
        "[public-media] D1 access check failed",
        safePublicErrorSummary(error),
      );
      return mediaUnavailableResponse("Media access check unavailable");
    }
    isAllowed = allowed?.allowed === 1;
    setCachedAccess(rawKey, isAllowed, now);
  }

  if (!isAllowed) return new Response("Not found", { status: 404 });

  let obj: Awaited<ReturnType<FlameNodeEnv["BUCKET"]["get"]>> | null;
  try {
    obj = await env.BUCKET.get(rawKey);
  } catch (error) {
    console.error(
      "[public-media] R2 read failed",
      safePublicErrorSummary(error),
    );
    return mediaUnavailableResponse("Media storage unavailable");
  }
  if (!obj) return new Response("Not found", { status: 404 });

  const contentType = normalizePublicMediaContentType(obj.httpMetadata?.contentType);
  if (!contentType || !isPublicMediaObjectSafe({ size: obj.size, contentType })) {
    await cancelR2BodyBestEffort(obj);
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", PUBLIC_MEDIA_CACHE_CONTROL);
  headers.set("x-content-type-options", "nosniff");
  if (
    ifNoneMatch &&
    ifNoneMatch.split(",").some((candidate) => {
      const normalized = candidate.trim();
      return normalized === "*" || normalized.replace(/^W\//, "") === obj.httpEtag;
    })
  ) {
    // ACL・MIME・サイズ検証の後にだけ304を返す。非公開化後のcache bypassを防ぐ。
    // 304ではR2 bodyをResponseへ渡さないため、明示的に接続資源を解放する。
    await cancelR2BodyBestEffort(obj);
    return new Response(null, { status: 304, headers });
  }

  const response = new Response(obj.body, { headers });
  if (cache && cacheKey) {
    try {
      const waitUntil = resolveWaitUntil();
      const putPromise = cache.put(cacheKey, response.clone()).catch(() => undefined);
      if (waitUntil) {
        waitUntil(putPromise);
      } else {
        await putPromise;
      }
    } catch {
      // cache put failed (best effort)
    }
  }
  return response;
}
