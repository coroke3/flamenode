import { AdminVideosResponseSchema, type AdminVideosResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** MIG-0729 U01: preserve CURRENT /admin/videos query keys and first-value semantics. */
export type AdminVideoFilters = {
  q: string;
  status: string;
  event: string;
  page: number;
};
const FILTERS = new Set(["review", "public", "private", "closed", "pending", "voided"]);
export const ADMIN_VIDEO_PAGE_SIZE = 50;

export function parseAdminVideoFilters(search: string): AdminVideoFilters {
  const params = new URLSearchParams(search);
  const rawPage = params.get("page") ?? "1";
  // Match apps/api/src/routes/adminRead/shared.ts#clampPage. CURRENT accepts
  // numeric page representations such as "0003" and "3.8"; reject unsafe D1 offsets.
  const raw = Number(rawPage);
  const candidate = Math.floor(raw);
  const offset = (candidate - 1) * ADMIN_VIDEO_PAGE_SIZE;
  const valid = Number.isFinite(raw) && raw >= 1 &&
    Number.isSafeInteger(candidate) && Number.isSafeInteger(offset) &&
    offset >= 0;
  const page = valid ? candidate : 1;
  const rawStatus = params.get("status") ?? "";
  return {
    q: params.get("q") ?? "",
    status: FILTERS.has(rawStatus) ? rawStatus : "",
    event: params.get("event") ?? "",
    page,
  };
}

export function buildAdminVideoHref(
  filters: Pick<AdminVideoFilters, "q" | "status" | "event">,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.event) params.set("event", filters.event);
  if (page !== undefined) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/videos?${query}` : "/admin/videos";
}

export function adminVideoTotalPages(paging: AdminVideosResponse["paging"]): number {
  if (!Number.isSafeInteger(paging.total) || paging.total <= 0) return 1;
  if (!Number.isSafeInteger(paging.pageSize) || paging.pageSize <= 0) return 1;
  return Math.ceil(paging.total / paging.pageSize);
}

/** Validates the complete DTO instead of trusting arbitrary JSON from a privileged read. */
export async function loadAdminVideos(
  fetchFn: OpsFetch,
  search: string,
  signal?: AbortSignal,
): Promise<OpsResult<AdminVideosResponse>> {
  const filters = parseAdminVideoFilters(search);
  const href = buildAdminVideoHref(filters, filters.page);
  const result = await getJson<unknown>(
    fetchFn,
    `/api/admin-read/videos${href.slice("/admin/videos".length)}`,
    signal,
  );
  if (result.status !== "ok") return result;
  const parsed = AdminVideosResponseSchema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

/** CURRENT Pagination: current +/- 2, first/last page and compact ellipses. */
export function adminVideoPageNumbers(current: number, total: number): (number | "…")[] {
  const pages: (number | "…")[] = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("…");
  }
  for (let page = start; page <= end; page++) pages.push(page);
  if (end < total) {
    if (end < total - 1) pages.push("…");
    pages.push(total);
  }
  return pages;
}

/**
 * CURRENT src/lib/utils/format.ts#formatRelative parity: 0 and future Unix
 * seconds are valid timestamps. Caller supplies the same rendering clock.
 */
export function adminVideoRelativeLabel(unixSec: number, nowUnixSec = Date.now() / 1000): string {
  if (!Number.isFinite(unixSec)) return "";
  const diff = nowUnixSec - unixSec;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}
