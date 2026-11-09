/**
 * MIG-0636 U05 SA-104: CURRENT src/lib/media/iconOrphanCleanup.ts parity.
 * Only call AFTER the icon/CAS/audit transaction has committed. Fail closed:
 * any unknown reference state or D1 failure must retain the R2 object.
 */
const PUBLIC_PREFIX = "/api/media/";
const NAMESPACES = new Set(["xicons", "video-icons"]);

export const XID_ORPHAN_ICON_REFERENCE_SQL = `
SELECT 1 AS referenced
WHERE EXISTS (
  SELECT 1 FROM x_users WHERE icon_url = ?1 LIMIT 1
) OR EXISTS (
  SELECT 1 FROM videos WHERE creator_icon_url = ?1 LIMIT 1
) OR EXISTS (
  SELECT 1 FROM events WHERE icon_url = ?1 OR img_url = ?1 LIMIT 1
) OR EXISTS (
  SELECT 1 FROM event_groups WHERE icon_url = ?1 OR img_url = ?1 LIMIT 1
) OR EXISTS (
  SELECT 1 FROM static_artifacts
  WHERE object_key = ?2 AND target_type = 'public_media'
    AND deleted_at IS NULL LIMIT 1
) LIMIT 1
`;

export function cleanupIconKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (!value.startsWith(PUBLIC_PREFIX)) return null;
  const key = value.slice(PUBLIC_PREFIX.length);
  if (!key || key.includes("..") || key.includes("\\\\") || /[\x00-\x1f\x7f]/.test(key)) return null;
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return null;
  const ns = key.slice(0, slash);
  if (!NAMESPACES.has(ns) || key.startsWith("xicons/staging/")) return null;
  return key;
}

export async function cleanupOldXIconAfterCommit(
  db: Pick<D1Database, "prepare">,
  bucket: Pick<R2Bucket, "delete">,
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined,
): Promise<boolean> {
  if (!oldUrl || oldUrl === newUrl) return false;
  const key = cleanupIconKey(oldUrl);
  if (!key) return false;
  // No deletion on an unknown D1 state, even if the old URL looks valid.
  let row: { referenced: number } | null;
  try {
    row = await db.prepare(XID_ORPHAN_ICON_REFERENCE_SQL)
      .bind(PUBLIC_PREFIX + key, key).first<{ referenced: number }>();
  } catch {
    return false;
  }
  if (row?.referenced === 1) return false;
  try {
    await bucket.delete(key);
    return true;
  } catch {
    // Cleanup is best effort, never revert a committed DB update or return
    // a mutation error that encourages a duplicate user update.
    return false;
  }
}
