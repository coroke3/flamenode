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
