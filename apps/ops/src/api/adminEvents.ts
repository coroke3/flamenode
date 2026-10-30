/**
 * MIG-0728 U02: read-only event index and template list, plus the CURRENT
 * template-delete action. These adapters are deliberately not mounted in the
 * shared Ops router until the upstream owner releases it.
 */
import {
  AdminEventsResponseSchema,
  AdminEventTemplatesResponseSchema,
  type AdminEventsResponse,
  type AdminEventTemplatesResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

type Parser<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false } };
async function readAdmin<T>(
  path: string,
  schema: Parser<T>,
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<T>> {
  const response = await getJson<unknown>(fetchFn, "/api/admin-read/" + path, signal);
  if (response.status !== "ok") return response;
  const parsed = schema.safeParse(response.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
const defaultFetch: OpsFetch = (path, init) => fetch(path, init);

/** CURRENT normalizes unknown filter and sort to all/newest respectively. */
export function eventIndexQuery(values: URLSearchParams): string {
  const next = new URLSearchParams();
  const sort = values.get("sort");
  const filter = values.get("filter");
  next.set("sort", sort === "oldest" || sort === "upcoming" ? sort : "newest");
  next.set("filter", filter === "public" || filter === "private" || filter === "accepting" ? filter : "all");
  next.set("q", (values.get("q") ?? "").trim());
  return next.toString();
}

export function readAdminEvents(
  values: URLSearchParams,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminEventsResponse>> {
  return readAdmin<AdminEventsResponse>("events?" + eventIndexQuery(values), AdminEventsResponseSchema, fetchFn, signal);
}

export function readAdminEventTemplates(
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminEventTemplatesResponse>> {
  return readAdmin<AdminEventTemplatesResponse>("events/templates", AdminEventTemplatesResponseSchema, fetchFn, signal);
}

export type TemplateDeleteResult =
  | { status: "ok" }
  | { status: "rejected"; message: string }
  | { status: "anonymous" | "forbidden" | "unavailable" };
const DELETE_ERROR = "削除に失敗しました。再読み込みして、もう一度お試しください。";
export async function deleteAdminEventTemplate(
  id: string,
  fetchFn: OpsFetch = defaultFetch,
): Promise<TemplateDeleteResult> {
  if (!id || id.trim() !== id) return { status: "unavailable" };
  try {
    const response = await fetchFn("/api/admin/event-templates/" + encodeURIComponent(id), {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    // Authorization must be decided from HTTP before any success-shaped JSON.
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (![200, 400, 404, 409, 500].includes(response.status)) return { status: "unavailable" };
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unavailable" };
    const record = value as Record<string, unknown>;
    if (response.status === 200 && record.ok === true) return { status: "ok" };
    if (record.ok === false) {
      return { status: "rejected", message: typeof record.message === "string" && record.message ? record.message : DELETE_ERROR };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});
const jstDateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
export function formatEventUnix(unix: number | null, dateOnly = false): string {
  if (unix == null || !Number.isFinite(unix)) return "-";
  const date = new Date(unix * 1000);
  if (!Number.isFinite(date.getTime())) return "-";
  return (dateOnly ? jstDate : jstDateTime).format(date);
}

/** Match @flamenode/domain/event/status, including single-ended point events. */
export function eventDisplayState(
  event: AdminEventsResponse["events"][number],
  now: number,
): { label: string; accepting: boolean } {
  if (event.visibility_status !== "public") return { label: "非公開", accepting: false };
  const point = (event.start_time != null) !== (event.end_time != null);
  let label = "公開";
  if (!point) {
    if (event.end_time != null && event.end_time <= now) label = "終了済";
    else if (event.start_time != null && event.start_time > now) label = "開始前";
    else if (event.start_time != null || event.end_time != null) label = "開催中";
  }
  const accepting = label !== "終了済" &&
    (event.entry_start_time != null || event.entry_end_time != null) &&
    (event.entry_start_time == null || event.entry_start_time <= now) &&
    (event.entry_end_time == null || event.entry_end_time > now);
  return { label, accepting };
}
