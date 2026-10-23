// MIG-0625: helpers shared by the admin read routes. No writes, no external calls.

/** ZERO_1102 S2: named LIMIT constants (<= 100) for every bounded read. */
export const ADMIN_USERS_PAGE_SIZE = 50;
export const ADMIN_VIDEOS_PAGE_SIZE = 50;
export const ADMIN_EVENT_OPTIONS_LIMIT = 100;
export const ADMIN_EVENTS_LIMIT = 60;
export const ADMIN_MODERATION_LIMIT = 100;
export const ADMIN_USER_DETAIL_LINKED_X_LIMIT = 100;
export const ADMIN_USER_DETAIL_VIDEOS_LIMIT = 20;
export const ADMIN_USER_DETAIL_AUDIT_LIMIT = 15;
export const ADMIN_USER_DETAIL_LINK_REQUESTS_LIMIT = 10;

/** CURRENT src/lib/utils/sql.ts escapeLike (note: CURRENT adds no ESCAPE clause, so neither do we). */
export function escapeLike(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw).replace(/[\\%_]/g, "\\$&");
}

/** CURRENT clampPaging with defaultPageSize === maxPageSize === pageSize. */
export function clampPage(pageRaw: unknown, pageSize: number): { page: number; pageSize: number; offset: number } {
  const raw = Number(pageRaw);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** CURRENT normalizeXId (packages/domain xid/format.ts) as SQL: JS trim whitespace set, strip all leading '@', lower. */
export function sqlNormalizeXId(column: string): string {
  return `lower(ltrim(trim(${column}, ' ' || char(9, 10, 11, 12, 13)), '@'))`;
}
