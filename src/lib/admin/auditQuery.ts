/** CURRENT /admin/audit query handling; Next may pass string[] for duplicate keys. */
export type AdminAuditQueryParam = string | string[] | undefined;
export type AdminAuditSearchParams = Record<string, AdminAuditQueryParam>;
export type AuditViewMode = "table" | "timeline" | "cards";

export const MAX_AUDIT_LIMIT = 100;
const DEFAULT_AUDIT_LIMIT = 50;

/** Duplicate or missing keys are ignored rather than coerced to comma-separated strings. */
export function readAuditQueryValue(raw: AdminAuditQueryParam): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** CURRENT normalizeViewMode compared the raw value without trimming whitespace. */
export function readAuditViewMode(raw: AdminAuditQueryParam): AuditViewMode {
  return raw === "timeline" || raw === "cards" ? raw : "table";
}

/** Legacy operator alias is used only when actor is absent or invalidly repeated. */
export function readAuditActorFilter(actor: AdminAuditQueryParam, operator: AdminAuditQueryParam): string {
  return Array.isArray(actor)
    ? readAuditQueryValue(operator)
    : readAuditQueryValue(actor ?? operator);
}

export function readAuditLimit(raw: AdminAuditQueryParam): number {
  const numeric = Number(readAuditQueryValue(raw));
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1, Math.min(Math.floor(numeric), MAX_AUDIT_LIMIT))
    : DEFAULT_AUDIT_LIMIT;
}

/** Reject impossible calendar dates before Date.parse can roll them into another month. */
export function readAuditDateBoundary(raw: string, end: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null;
  const suffix = end ? "T23:59:59+09:00" : "T00:00:00+09:00";
  const timestamp = Date.parse(`${raw}${suffix}`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

/** Preserve single-valued filters while dropping duplicate keys on view switches. */
export function buildAuditViewHref(
  searchParams: AdminAuditSearchParams,
  view: AuditViewMode,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key !== "view" && typeof value === "string" && value) {
      params.set(key, value);
    }
  }
  params.set("view", view);
  return `/admin/audit?${params.toString()}`;
}
