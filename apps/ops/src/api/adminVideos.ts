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
  const requestedPage = /^(0|[1-9][0-9]*)$/.test(rawPage) ? Number(rawPage) : NaN;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
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
