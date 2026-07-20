import type { FlameNodeEnv } from "@/lib/cloudflare";

export const MAX_PUBLIC_MEDIA_BYTES = 5 * 1024 * 1024;

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

export function getPublicMediaNamespace(key: string): PublicMediaNamespace | null {
  const separator = key.indexOf("/");
  if (separator <= 0 || separator === key.length - 1) return null;
  const namespace = key.slice(0, separator);
  return (PUBLIC_MEDIA_NAMESPACES as readonly string[]).includes(namespace)
    ? (namespace as PublicMediaNamespace)
    : null;
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

export async function servePublicMedia(
  env: Pick<FlameNodeEnv, "DB" | "BUCKET">,
  rawKey: string,
): Promise<Response> {
  if (
    !rawKey ||
    rawKey.includes("..") ||
    rawKey.includes("\\") ||
    /[\x00-\x1F\x7F]/.test(rawKey)
  ) {
    return new Response("Not found", { status: 404 });
  }

  const namespace = getPublicMediaNamespace(rawKey);
  if (!namespace) return new Response("Not found", { status: 404 });

  const publicUrl = `/api/media/${rawKey}`;
  let allowed: { allowed: number } | null = null;
  try {
    allowed = await env.DB.prepare(PUBLIC_MEDIA_ACCESS_SQL)
      .bind(rawKey, namespace, publicUrl)
      .first<{ allowed: number }>();
  } catch (error) {
    console.error("[public-media] D1 access check failed", error);
    return new Response("Media access check unavailable", { status: 503 });
  }
  if (allowed?.allowed !== 1) return new Response("Not found", { status: 404 });

  const obj = await env.BUCKET.get(rawKey);
  if (!obj) return new Response("Not found", { status: 404 });

  const contentType = normalizePublicMediaContentType(obj.httpMetadata?.contentType);
  if (!contentType || !isPublicMediaObjectSafe({ size: obj.size, contentType })) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}
