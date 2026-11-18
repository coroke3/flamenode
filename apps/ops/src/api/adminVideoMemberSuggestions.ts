// MIG-0730 U02e: authenticated RH-019 X-user search adapter (READ ONLY).
// The existing Hono endpoint enforces the session. This client never confers
// permission to edit members, apply collaborator grants, or execute SA-085.
import type { OpsFetch } from "./read.js";

export type AdminMemberSuggestionSearchResponse = {
  items: { id: string; x_name: string | null; score?: number; matchedBy?: string }[];
  hasMore: boolean;
  nextOffset: number | null;
  hint: string | null;
};

const SEARCH_LIMIT = 20;
const QUERY_MAX_CHARS = 64;
const OFFSET_MAX = 5000;
// RH-019's V1 and V2 R2 index readers both guarantee this canonical shape.
// Do not allow a forged HTTP 200 to hand malformed X IDs to the editor.
const X_USER_ID_RE = /^[a-z0-9_]{1,64}$/;

function parseSuggestions(
  body: unknown, requestedQuery: string, requestedOffset: number,
): AdminMemberSuggestionSearchResponse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("member_suggestions_unavailable");
  }
  // Even though a normal Response.json() returns plain data, a legacy/mock
  // fetch port can inject accessor objects. Bind every checked field once:
  // do not validate one private page and then render a second getter value.
  const value = body as Record<string, unknown>;
  const query = value.query;
  const limit = value.limit;
  const offset = value.offset;
  const rawItems = value.items;
  const hasMore = value.hasMore;
  const nextOffset = value.nextOffset;
  const hint = value.hint;
  const source = value.source;
  if (!Array.isArray(rawItems)) throw new Error("member_suggestions_unavailable");
  const count = rawItems.length;
  if (query !== requestedQuery || limit !== SEARCH_LIMIT ||
      offset !== requestedOffset || count > SEARCH_LIMIT ||
      typeof hasMore !== "boolean" ||
      (nextOffset !== null &&
        (typeof nextOffset !== "number" || !Number.isSafeInteger(nextOffset) ||
         nextOffset <= requestedOffset ||
         nextOffset > OFFSET_MAX + SEARCH_LIMIT ||
         nextOffset !== requestedOffset + count)) ||
      (hasMore === false && nextOffset !== null) ||
      // Cursorless continuation is only RH-019 V2's empty refine answer.
      (hasMore === true && nextOffset === null &&
        (count !== 0 || source !== "v2" ||
         typeof hint !== "string" || !hint.trim())) ||
      (hint !== null && (typeof hint !== "string" || hint.length > 256))) {
    throw new Error("member_suggestions_unavailable");
  }

  const seenIds = new Set<string>();
  const items: AdminMemberSuggestionSearchResponse["items"] = [];
  // Numeric indexing avoids a custom array iterator/map altering the page
  // after the bounded count was checked. Each row property is read once.
  for (let i = 0; i < count; i += 1) {
    const raw: unknown = rawItems[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("member_suggestions_unavailable");
    }
    const row = raw as Record<string, unknown>;
    const id = row.id;
    const xName = row.x_name;
    const score = row.score;
    const matchedBy = row.matchedBy;
    if (typeof id !== "string" || !X_USER_ID_RE.test(id) ||
        (xName !== null && typeof xName !== "string") ||
        (typeof xName === "string" && xName.length > 256) ||
        (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) ||
        (matchedBy !== undefined &&
          (typeof matchedBy !== "string" || matchedBy.length > 64)) ||
        seenIds.has(id)) {
      throw new Error("member_suggestions_unavailable");
    }
    seenIds.add(id);
    items.push({
      id,
      x_name: xName as string | null,
      ...(typeof score === "number" ? { score } : {}),
      ...(typeof matchedBy === "string" ? { matchedBy } : {}),
    });
  }
  return {
    items,
    hasMore,
    nextOffset: nextOffset as number | null,
    hint: hint as string | null,
  };
}

/** Fail closed; the shared form displays a search error on rejected calls. */
export async function searchAdminVideoMemberXUsers(
  q: string,
  offset: number,
  signal: AbortSignal,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
): Promise<AdminMemberSuggestionSearchResponse> {
  if (typeof q !== "string" || q.length > QUERY_MAX_CHARS || !q.trim() ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > OFFSET_MAX ||
      signal.aborted) {
    throw new Error("member_suggestions_unavailable");
  }
  let encoded: string;
  try { encoded = encodeURIComponent(q.trim()); }
  catch { throw new Error("member_suggestions_unavailable"); }
  // An injected search port can reject with provider/private details.
  // Callers only receive the stable, non-sensitive unavailable error.
  let response: Response;
  try {
    response = await fetchFn(
      `/api/internal/x-users/search?q=${encoded}&limit=${SEARCH_LIMIT}&offset=${offset}`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      },
    );
  } catch {
    throw new Error("member_suggestions_unavailable");
  }
  if (signal.aborted || response.status !== 200) {
    throw new Error("member_suggestions_unavailable");
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("member_suggestions_unavailable"); }
  if (signal.aborted) throw new Error("member_suggestions_unavailable");
  // Do not propagate private/malformed accessor errors from an injected JSON
  // port. A getter may also revoke the AbortSignal during synchronous parsing;
  // check cancellation once more before publishing private candidates.
  let parsed: AdminMemberSuggestionSearchResponse;
  try {
    parsed = parseSuggestions(body, q.trim(), offset);
  } catch {
    throw new Error("member_suggestions_unavailable");
  }
  if (signal.aborted) throw new Error("member_suggestions_unavailable");
  return parsed;
}
