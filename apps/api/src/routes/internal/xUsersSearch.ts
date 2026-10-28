/**
 * MIG-0648 RH-019: authenticated X-user autocomplete over internal R2 artifacts.
 *
 * CURRENT: app/api/internal/x-users/search/route.ts (GET).
 * Invariants: never query D1 except session lookup; exact CURRENT private
 * headers, status/error bodies, paging, score ordering and V2->V1 fallback.
 * No public artifact or write-side access is permitted here.
 */
import { Hono, type Context } from "hono";
// Temporary source-level imports until the other writers release
// packages/server-core/package.json. U03 replaces these with package subpaths.
import { loadMemberSuggestionsCandidatesV2FromBucket } from "../../../../../packages/server-core/src/memberSuggestion/v2Loader.ts";
import { loadMemberSuggestionsIndexFromBucket } from "../../../../../packages/server-core/src/memberSuggestion/loader.ts";
import { searchMemberSuggestions } from "../../../../../packages/server-core/src/memberSuggestion/search.ts";
import type { MemberSuggestionItem } from "../../../../../packages/server-core/src/memberSuggestion/core.ts";
import { requireAuth, sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OFFSET = 5000;
const MAX_QUERY_LENGTH = 64;
const MAX_NUMERIC_PARAM_LENGTH = 8;
const MIN_SEARCH_CHARS = 2;
const INDEX_LOAD_TIMEOUT_MS = 2500;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;
const UNAVAILABLE_HEADERS = { ...PRIVATE_HEADERS, "Retry-After": "3" } as const;
const REFINE_HINT = "候補が多いため、名前またはX IDを追加で入力してください。";

type SearchContext = Context<AppEnv>;
type Source = "v1" | "v2";

function parseBoundedDecimalParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = (value ?? "").trim().slice(0, MAX_NUMERIC_PARAM_LENGTH);
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function compactSearchChars(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "");
}

function queryCompactLength(query: string): number {
  return compactSearchChars(
    query
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/^[^\p{L}\p{N}_]+/u, ""),
  ).length;
}

function respond(c: SearchContext, body: unknown, unavailable = false): Response {
  return unavailable
    ? c.json(body, 503, UNAVAILABLE_HEADERS)
    : c.json(body, 200, PRIVATE_HEADERS);
}

function unavailable(c: SearchContext): Response {
  return respond(c, { error: "suggestions_unavailable" }, true);
}

function emptyResult(c: SearchContext, query: string, limit: number, offset: number, hint: string | null): Response {
  return respond(c, {
    items: [], query, limit, offset,
    nextOffset: null, hasMore: false, hint,
  });
}

function refineQuery(c: SearchContext, query: string, limit: number, offset: number): Response {
  return respond(c, {
    items: [], query, limit, offset,
    nextOffset: null, hasMore: true, hint: REFINE_HINT, source: "v2",
  });
}

function searchResult(
  c: SearchContext,
  items: MemberSuggestionItem[],
  query: string,
  limit: number,
  offset: number,
  onlyApproved: boolean,
  source: Source,
) {
  const result = searchMemberSuggestions(items, { query, limit, offset, onlyApproved });
  const response = respond(c, {
    items: result.items.map((item) => ({
      id: item.x_user_id,
      x_name: item.name,
      score: item.score,
      matchedBy: item.matchedBy,
    })),
    query, limit, offset,
    nextOffset: result.nextOffset,
    hasMore: result.hasMore,
    hint: result.hasMore ? REFINE_HINT : null,
    source,
  });
  return { response, result };
}

async function withIndexTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("suggestions_index_timeout")),
      INDEX_LOAD_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export const xUsersSearchRoutes = new Hono<AppEnv>();

// Auth.js cookie D1 lookup is the only permitted D1 read. The shared auth
// guard decides the status; this endpoint maps its bodies to CURRENT
// requireRouteUser error codes (lower-case), without changing other APIs.
xUsersSearchRoutes.use("*", async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) c.header(name, value);
});
xUsersSearchRoutes.use("*", sessionMiddleware());
xUsersSearchRoutes.use("*", async (c, next) => {
  const denied = await requireAuth()(c, next);
  if (!denied) return;
  if (denied.status === 401) return c.json({ error: "unauthorized" }, 401, PRIVATE_HEADERS);
  if (denied.status === 403) return c.json({ error: "account_disabled" }, 403, PRIVATE_HEADERS);
  return c.json({ error: "database_unavailable" }, 503, PRIVATE_HEADERS);
});

xUsersSearchRoutes.get("/", async (c) => {
  const url = new URL(c.req.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const onlyApproved = url.searchParams.get("onlyApproved") === "1";
  const limit = parseBoundedDecimalParam(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseBoundedDecimalParam(url.searchParams.get("offset"), 0, 0, MAX_OFFSET);
  if (!query) return emptyResult(c, query, limit, offset, null);
  const compactLength = queryCompactLength(query);
  if (compactLength < MIN_SEARCH_CHARS) {
    return emptyResult(c, query, limit, offset, "search_too_short");
  }

  const bucket = c.env?.BUCKET;
  if (!bucket) {
    console.warn("[x-users-search] bucket binding unavailable");
    return unavailable(c);
  }

  try {
    const v2 = await withIndexTimeout(loadMemberSuggestionsCandidatesV2FromBucket(bucket, query));
    if (v2.ok) {
      if (v2.truncated) return refineQuery(c, query, limit, offset);
      const searched = searchResult(c, v2.items, query, limit, offset, onlyApproved, "v2");
      // Short queries have no fuzzy candidates. Longer queries require the
      // V1 compatibility fallback unless the current page is provably complete.
      const pageIsComplete =
        compactLength <= 2 ||
        (searched.result.items.length === limit &&
          searched.result.hasMore &&
          searched.result.items.every((item) => !item.matchedBy.startsWith("fuzzy_")));
      if (pageIsComplete) return searched.response;
    } else if (v2.reason === "query_budget_exceeded") {
      return refineQuery(c, query, limit, offset);
    }

    const v1 = await withIndexTimeout(loadMemberSuggestionsIndexFromBucket(bucket));
    if (!v1.ok) {
      console.warn("[x-users-search] suggestions unavailable", {
        v2_reason: v2.ok ? "compatibility_fallback" : v2.reason,
        v1_reason: v1.reason,
      });
      return unavailable(c);
    }
    return searchResult(c, v1.items, query, limit, offset, onlyApproved, "v1").response;
  } catch (error) {
    console.error("[x-users-search] suggestion lookup failed", error);
    return unavailable(c);
  }
});
