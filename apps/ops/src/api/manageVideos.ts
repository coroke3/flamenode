/** MIG-0724 U02: read-only Manage video queue; CURRENT caps list at 200, Hono at 100/request. */
import { ManageVideosResponseSchema, type ManageVideosResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

const PAGE_SIZE = 100;
const MAX_ROWS = 200;
export const VIDEO_FILTERS = [
  { value: "all", label: "すべて" },
  { value: "review", label: "審査待ち" },
  { value: "public", label: "公開" },
  { value: "private", label: "非公開" },
  { value: "closed", label: "無効" },
] as const;
const STATUSES = ["pending", "public", "private", "voided"] as const;
export function normalizeVideoFilter(raw: string | null | undefined): string {
  if (raw === "" || raw === "all") return "";
  if (raw === undefined || raw === null) return "review";
  if (VIDEO_FILTERS.some(f => f.value === raw) || STATUSES.some(s => s === raw)) return raw;
  return "review";
}
function validPage(raw: unknown, eventId: string, filter: string, offset: number): ManageVideosResponse | null {
  const parsed = ManageVideosResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const page = parsed.data;
  if (page.event.id !== eventId || page.statusFilter !== filter ||
    page.offset !== offset || page.pageSize !== PAGE_SIZE || page.rows.length > PAGE_SIZE ||
    page.pendingCount < 0 || !Number.isSafeInteger(page.pendingCount)) return null;
  // A malformed page must never be interpreted as authorized event data.
  for (const row of page.rows) {
    if (!row.id || !Number.isSafeInteger(row.created_at) || row.required_unanswered_count < 0 ||
      !Number.isSafeInteger(row.required_unanswered_count)) return null;
  }
  return page;
}
function sameHeader(a: ManageVideosResponse, b: ManageVideosResponse): boolean {
  return a.isAdmin === b.isAdmin &&
    a.event.id === b.event.id &&
    a.event.title === b.event.title &&
    a.event.accent_color === b.event.accent_color &&
    a.pendingCount === b.pendingCount &&
    a.canApproveVideoStatus === b.canApproveVideoStatus &&
    a.statusFilter === b.statusFilter &&
    a.filterLabel === b.filterLabel &&
    a.isReviewFilter === b.isReviewFilter;
}
export function createManageVideosApi(fetchFn: OpsFetch) {
  return {
    async getList(eventId: string, rawFilter: string | null | undefined, signal?: AbortSignal):
      Promise<OpsResult<ManageVideosResponse>> {
      if (!eventId || signal?.aborted) return { status: "unavailable" };
      const filter = normalizeVideoFilter(rawFilter);
      const eventPath = encodeURIComponent(eventId);
      const seen = new Set<string>();
      let first: ManageVideosResponse | null = null;
      const combined: ManageVideosResponse["rows"] = [];
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        if (signal?.aborted) return { status: "unavailable" };
        const url = `/api/manage/events/${eventPath}/videos?status=${encodeURIComponent(filter)}&offset=${offset}`;
        const result = await getJson<unknown>(fetchFn, url, signal);
        if (result.status !== "ok") return result;
        const page = validPage(result.data, eventId, filter, offset);
        if (!page || (first && !sameHeader(first, page))) return { status: "unavailable" };
        if (!first) first = page;
        for (const row of page.rows) {
          if (seen.has(row.id)) return { status: "unavailable" };
          seen.add(row.id);
          combined.push(row);
        }
        if (page.rows.length < PAGE_SIZE) break;
      }
      if (!first || signal?.aborted) return { status: "unavailable" };
      return { status: "ok", data: { ...first, offset: 0, rows: combined } };
    },
  };
}
