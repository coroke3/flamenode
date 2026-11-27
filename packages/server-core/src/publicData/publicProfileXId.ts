import { isCanonicalXId, normalizeXId } from "@flamenode/domain/xid";

/**
 * Public snapshots are not trusted to supply safe URL path segments.
 * Keep legacy @/mixed-case X handles compatible, but never promote a path,
 * query, fragment, or overlong identifier into a /user/{id} link.
 */
export function normalizePublicProfileXId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = normalizeXId(value);
  return isCanonicalXId(id) ? id : null;
}
