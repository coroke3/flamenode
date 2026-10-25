/**
 * `/list` query keys (MIG-0505 U04 / coverage gap G03). Rules are CURRENT `ListIndexView.tsx`'s:
 * the rewrite in `next.config.mjs` sends a request to the per-request twin only when a key has a
 * non-empty value (`value: ".+"`); an empty or unknown key renders the default view.
 *
 * | key   | normalization                                   | default | static HTML | Island (MIG-0507) |
 * | q     | trim, 100 chars; < 2 letters/digits = too short | ""      | default only | search       |
 * | sort  | first 16 chars; `old` / `score`, else `new`      | new     | default only | select       |
 * | page  | 12 chars digits only, 1..ceil(5000/24)          | 1       | page 1 only  | pagination   |
 * | event | trim, 128 chars                                 | ""      | default only | event filter |
 * | view  | `index` / `compact`, else `grid`                | grid    | grid only    | view switch  |
 */
export const LIST_QUERY_KEYS = ["q", "sort", "page", "event", "view"] as const;
export const LIST_PAGE_SIZE = 24;
export const LIST_MAX_SEARCH_LENGTH = 100;
export const LIST_MAX_EVENT_ID_LENGTH = 128;
export const LIST_MIN_SEARCH_CHARS = 2;
export const LIST_MAX_PAGE = Math.ceil(5_000 / LIST_PAGE_SIZE);

type Raw = string | string[] | undefined;
export type ListQueryInput = Partial<Record<(typeof LIST_QUERY_KEYS)[number], Raw>>;
export type ListSort = "new" | "old" | "score";
export type ListViewMode = "grid" | "compact" | "index";

export type ListQuery = Readonly<{
  q: string;
  sort: ListSort;
  page: number;
  event: string;
  view: ListViewMode;
  searchTooShort: boolean;
  /** True when Next would route to the query twin: some key has a non-empty value. */
  routesToQueryTwin: boolean;
}>;

function first(value: Raw, fallback = ""): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v) => typeof v === "string") ?? fallback;
  return fallback;
}

function compactSearchChars(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
}

function boundedPage(value: string): number {
  const raw = value.trim().slice(0, 12);
  if (!/^\d+$/.test(raw)) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, LIST_MAX_PAGE);
}

export function normalizeListQuery(input: ListQueryInput): ListQuery {
  const rawSort = first(input.sort, "new").slice(0, 16);
  const rawView = first(input.view, "grid");
  const q = first(input.q).trim().slice(0, LIST_MAX_SEARCH_LENGTH);
  return {
    q,
    sort: rawSort === "old" || rawSort === "score" ? rawSort : "new",
    page: boundedPage(first(input.page, "1")),
    event: first(input.event).trim().slice(0, LIST_MAX_EVENT_ID_LENGTH),
    view: rawView === "index" ? "index" : rawView === "compact" ? "compact" : "grid",
    searchTooShort: q.length > 0 && compactSearchChars(q).length < LIST_MIN_SEARCH_CHARS,
    routesToQueryTwin: LIST_QUERY_KEYS.some((key) => [input[key]].flat().some((v) => typeof v === "string" && v.length > 0)),
  };
}
