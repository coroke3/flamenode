import "server-only";

import { getPublicMediaNamespace } from "@/lib/media/publicMedia";

const PUBLIC_MEDIA_URL_PREFIX = "/api/media/";
const ICON_CLEANUP_NAMESPACES = new Set(["xicons", "video-icons"]);

export const ICON_REFERENCE_CHECK_SQL = `
SELECT 1 AS referenced
WHERE EXISTS (
  SELECT 1 FROM x_users xu
  WHERE xu.icon_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM videos v
  WHERE v.creator_icon_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM events e
  WHERE e.icon_url = ?1 OR e.img_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM event_groups eg
  WHERE eg.icon_url = ?1 OR eg.img_url = ?1
  LIMIT 1
)
OR EXISTS (
  SELECT 1 FROM static_artifacts sa
  WHERE sa.object_key = ?2
    AND sa.target_type = 'public_media'
    AND sa.deleted_at IS NULL
  LIMIT 1
)
LIMIT 1
`;

function isUnsafeMediaKey(key: string): boolean {
  return !key || key.includes("..") || key.includes("\\") || /[\x00-\x1F\x7F]/.test(key);
}

function isAllowedIconCleanupKey(key: string): boolean {
  if (isUnsafeMediaKey(key)) return false;
  const namespace = getPublicMediaNamespace(key);
  if (!namespace || !ICON_CLEANUP_NAMESPACES.has(namespace)) return false;
  if (namespace === "xicons" && key.startsWith("xicons/staging/")) return false;
  return true;
}

export function extractPublicMediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const normalized = url.trim();
  if (!normalized.startsWith(PUBLIC_MEDIA_URL_PREFIX)) return null;
  const key = normalized.slice(PUBLIC_MEDIA_URL_PREFIX.length);
  if (!key || isUnsafeMediaKey(key)) return null;
  return key;
}

async function isIconUrlReferenced(
  db: Pick<D1Database, "prepare">,
  mediaUrl: string,
  objectKey: string,
): Promise<boolean | null> {
  try {
    const row = await db
      .prepare(ICON_REFERENCE_CHECK_SQL)
      .bind(mediaUrl, objectKey)
      .first<{ referenced: number }>();
    return row?.referenced === 1;
  } catch (error) {
    console.error("[icon-orphan-cleanup] reference check failed", error);
    return null;
  }
}

function cleanupFailureLogTag(objectKey: string): string {
  return objectKey.startsWith("video-icons/")
    ? "video_icon_orphan_cleanup_failed"
    : "x_icon_orphan_cleanup_failed";
}

export async function tryDeleteUnreferencedIcon(
  db: Pick<D1Database, "prepare">,
  bucket: Pick<R2Bucket, "delete">,
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined,
): Promise<void> {
  if (!oldUrl || oldUrl === newUrl) return;

  const objectKey = extractPublicMediaKeyFromUrl(oldUrl);
  if (!objectKey || !isAllowedIconCleanupKey(objectKey)) return;

  const mediaUrl = `${PUBLIC_MEDIA_URL_PREFIX}${objectKey}`;
  const referenced = await isIconUrlReferenced(db, mediaUrl, objectKey);
  if (referenced !== false) return;

  try {
    await bucket.delete(objectKey);
  } catch (error) {
    console.error(cleanupFailureLogTag(objectKey), error);
  }
}
