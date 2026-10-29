/** MIG-0510: pure /list URL, RH-032 public response and view projection. No React or browser globals. */
import { LIST_PAGE_SIZE, normalizeListQuery, type ListQuery, type ListQueryInput } from "./listQuery.ts";
import { toListVideo } from "./videoCards.ts";
import type { PublicVideoDto } from "../../../../packages/server-core/src/publicData/publicDto.ts";
import type { ListVideo } from "@flamenode/ui";

export const LIST_REFLECTING_MESSAGE = "作品一覧への反映を準備しています。しばらくしてから再読み込みしてください。";
export const LIST_UNAVAILABLE_MESSAGE = "作品一覧を一時的に表示できません。";
export const LIST_EVENT_UNAVAILABLE_MESSAGE = "このイベントの作品一覧を一時的に表示できません。";
export const LIST_NO_RESULTS_MESSAGE = "条件に合う作品が見つかりませんでした。条件を変えてお試しください。";
export const LIST_SHORT_SEARCH_MESSAGE = "検索は文字・数字を2文字以上入力してください。";

export interface PublicVideoList {
  items: PublicVideoDto[];
  total: number;
  page: number;
  limit: number;
}

export function listQueryFromSearch(search: string): ListQuery {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const input: ListQueryInput = {};
  for (const key of ["q", "sort", "page", "event", "view"] as const) {
    const all = params.getAll(key);
    if (all.length > 0) input[key] = all;
  }
  return normalizeListQuery(input);
}

export function listHref(query: ListQuery, overrides: Partial<Record<"q" | "sort" | "event" | "view" | "page", string>> = {}): string {
  const merged = {
    q: query.q, sort: query.sort, page: String(query.page), event: query.event, view: query.view,
    ...overrides,
  };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.sort && merged.sort !== "new") params.set("sort", merged.sort);
  if (merged.event) params.set("event", merged.event);
  if (merged.view && merged.view !== "grid") params.set("view", merged.view);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const suffix = params.toString();
  return suffix ? `/list?${suffix}` : "/list";
}

/** CURRENT 24-item page and exact RH-032 query keys; view is client-only. */
export function publicListApiPath(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort !== "new") params.set("sort", query.sort);
  if (query.event) params.set("event", query.event);
  if (query.page !== 1) params.set("page", String(query.page));
  params.set("limit", String(LIST_PAGE_SIZE));
  return `/api/videos?${params}`;
}

export function isDefaultListQuery(query: ListQuery): boolean {
  return !query.q && !query.event && query.page === 1 && query.sort === "new" && query.view === "grid";
}

function isVideo(value: unknown): value is PublicVideoDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.status === "public" &&
    typeof v.id === "string" && v.id.length > 0 &&
    typeof v.title === "string" &&
    (v.youtube_video_id === null || typeof v.youtube_video_id === "string") &&
    (v.display_name === null || typeof v.display_name === "string") &&
    (v.icon_url === null || typeof v.icon_url === "string") &&
    (v.primary_event_id === null || typeof v.primary_event_id === "string") &&
    (v.scheduled_time === null || (typeof v.scheduled_time === "number" && Number.isFinite(v.scheduled_time)));
}

/** Fail closed on a malformed/public-private mixed response. Never render unknown rows. */
export function decodePublicList(data: unknown, query: ListQuery): { videos: ListVideo[]; total: number; page: number; totalPages: number } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (!Array.isArray(row.items) || row.items.length > LIST_PAGE_SIZE ||
      !Number.isSafeInteger(row.total) || (row.total as number) < 0 ||
      !Number.isSafeInteger(row.page) || row.page !== query.page ||
      row.limit !== LIST_PAGE_SIZE || !row.items.every(isVideo)) return null;
  const videos = (row.items as PublicVideoDto[]).map(v => toListVideo({ ...v, display_name: v.display_name ?? "" }));
  return { videos, total: row.total as number, page: query.page, totalPages: Math.max(1, Math.ceil((row.total as number) / LIST_PAGE_SIZE)) };
}
