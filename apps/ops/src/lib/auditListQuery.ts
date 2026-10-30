/** CURRENT /admin/audit GET filters (JST date boundaries are interpreted by the Hono API). */
export type AuditView = "table" | "timeline" | "cards";
export type AuditListQuery = Readonly<{
  view: AuditView;
  table: string;
  operation: string;
  actor: string;
  record: string;
  restore_status: string;
  since: string;
  until: string;
  limit: number;
}>;
const OPERATIONS = new Set(["CREATE","UPDATE","DELETE","RESTORE","STATUS_CHANGE","MERGE","SYSTEM"]);
const RESTORE_STATUSES = new Set(["restorable","restored","expired","not_restorable","blocked","failed"]);

export function parseAuditListQuery(search: string | URLSearchParams): AuditListQuery {
  const query = typeof search === "string" ? new URLSearchParams(search) : search;
  const get = (key: string) => (query.get(key) ?? "").trim();
  const requested = Number(query.get("limit") ?? "");
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 100) : 50;
  const view = get("view");
  const operation = get("operation").toUpperCase();
  const status = get("restore_status");
  return {
    view: view === "cards" || view === "timeline" ? view : "table",
    table: get("table"),
    operation: OPERATIONS.has(operation) ? operation : "",
    actor: query.has("actor") ? get("actor") : get("operator"),
    record: get("record"),
    restore_status: RESTORE_STATUSES.has(status) ? status : "",
    since: get("since"),
    until: get("until"),
    limit,
  };
}

/** Transport drops display-only view and the old operator alias. */
export function auditListApiPath(query: AuditListQuery): string {
  const params = new URLSearchParams();
  for (const key of ["table","operation","actor","record","restore_status","since","until"] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  params.set("limit", String(query.limit));
  return "/api/admin-read/audit?" + params.toString();
}

/** Display mode changes preserve every normalized GET filter, including actor. */
export function auditViewHref(query: AuditListQuery, view: AuditView): string {
  const params = new URLSearchParams();
  for (const key of ["table","operation","actor","record","restore_status","since","until"] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  params.set("limit", String(query.limit));
  params.set("view", view);
  return "/admin/audit?" + params.toString();
}
