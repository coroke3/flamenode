/** Hono RH-023 port of CURRENT public media policy. */
export type PublicMediaEnv = { DB: D1Database; BUCKET: R2Bucket };
import { cancelR2BodyBestEffort } from "@flamenode/server-core/r2Body";
import { safeErrorSummary } from "../../../../../workers/shared/safeLog.ts";

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
 * URL may stop being public when its owner/event/video is unpublished.
 * Browsers and shared CDNs must revalidate at the origin on every request.
 */
export const PUBLIC_MEDIA_CACHE_CONTROL = "no-store";
/** Cache API stores bytes only; every origin hit still performs a fresh D1 ACL check. */
const PUBLIC_MEDIA_INTERNAL_CACHE_CONTROL = "public, max-age=0, s-maxage=604800";

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

/**
 * Compatibility test hook. There is deliberately no isolate ACL cache:
 * a public -> private transition must be visible to the next origin request.
 */
export function clearPublicMediaAccessCacheForTest(): void {}

/** Called only AFTER the request's fresh D1 visibility check. Cached bytes are not authorization. */
async function getCachedPublicMediaResponse(
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
      const headers = new Headers(cached.headers);
      headers.set("cache-control", PUBLIC_MEDIA_CACHE_CONTROL);
      return new Response(null, { status: 304, headers });
    }
    const headers = new Headers(cached.headers);
    headers.set("cache-control", PUBLIC_MEDIA_CACHE_CONTROL);
    return new Response(cached.body, { status: cached.status, headers });
  } catch {
    // Cache miss / lookup error, continue to D1/R2 on the origin path.
    return null;
  }
}

export async function servePublicMedia(
  env: PublicMediaEnv,
  rawKey: string,
  request?: Request,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<Response> {
  if (!isValidPublicMediaKey(rawKey)) return new Response("Not found", { status: 404 });

  const namespace = getPublicMediaNamespace(rawKey)!;

  const ifNoneMatch = request?.headers.get("If-None-Match");
  const cache = getEdgeCache();
  const cacheKey = getMediaCacheKey(request, rawKey);

  // Access status is mutable. A cached 200 or 304 may NEVER bypass this read.
  const publicUrl = `/api/media/${rawKey}`;
  let allowed: { allowed: number } | null;
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
  if (allowed?.allowed !== 1) return new Response("Not found", { status: 404 });

  // Reuse immutable image bytes without reusing the cached ACL or public HTTP headers.
  if (request) {
    const cached = await getCachedPublicMediaResponse(request, rawKey);
    if (cached) return cached;
  }

  let obj: R2ObjectBody | null;
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
      const waitUntil = options?.waitUntil;
      const cacheCopy = response.clone();
      cacheCopy.headers.set("cache-control", PUBLIC_MEDIA_INTERNAL_CACHE_CONTROL);
      const putPromise = cache.put(cacheKey, cacheCopy).catch(() => undefined);
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
