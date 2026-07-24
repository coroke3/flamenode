const PREFIXED_INTERNAL_VIDEO_ID_RE =
  /^[a-z][a-z0-9_]*_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARE_INTERNAL_VIDEO_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** generateId() 由来の内部 ID 形式。PK miss 時に YouTube ID 検索へ進めない。 */
export function isConfirmedInternalVideoId(id: string): boolean {
  const trimmed = id.trim();
  return (
    PREFIXED_INTERNAL_VIDEO_ID_RE.test(trimmed) ||
    BARE_INTERNAL_VIDEO_ID_RE.test(trimmed)
  );
}
