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
  const value = body as Record<string, unknown>;
  // RH-019 echoes the authoritative request identity in every 200 response.
  // Reject a mismatched page/query rather than render another search's private
  // X-user suggestions or reuse an unrelated pagination cursor.
  if (value.query !== requestedQuery || value.limit !== SEARCH_LIMIT ||
      value.offset !== requestedOffset ||
      !Array.isArray(value.items) || value.items.length > SEARCH_LIMIT ||
      typeof value.hasMore !== "boolean" ||
      (value.nextOffset !== null &&
        (!Number.isSafeInteger(value.nextOffset) ||
         // The RH-019 ranked search always advances a non-null cursor.
         // No-progress cursors can re-request the same private result page.
         (value.nextOffset as number) <= requestedOffset ||
         (value.nextOffset as number) > OFFSET_MAX + SEARCH_LIMIT ||
         // The ranker continues from exactly the end of this received page.
         // A larger value silently skips private candidates.
         (value.nextOffset as number) !== requestedOffset + value.items.length)) ||
      // A completed page cannot simultaneously advertise a next page.
      (value.hasMore === false && value.nextOffset !== null) ||
      // A null cursor with hasMore=true is exclusively RH-019 V2's
      // explicit "refine query" answer. Without a nonblank hint and v2
      // source, this would be an ambiguous, non-pageable private result.
      (value.hasMore === true && value.nextOffset === null &&
        (value.items.length !== 0 ||
         value.source !== "v2" ||
         typeof value.hint !== "string" ||
         !value.hint.trim())) ||
      (value.hint !== null && (typeof value.hint !== "string" || value.hint.length > 256))) {
    throw new Error("member_suggestions_unavailable");
  }
  const items = value.items.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("member_suggestions_unavailable");
    }
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !X_USER_ID_RE.test(row.id) ||
        (row.x_name !== null && typeof row.x_name !== "string") ||
        (typeof row.x_name === "string" && row.x_name.length > 256) ||
        (row.score !== undefined && (typeof row.score !== "number" || !Number.isFinite(row.score))) ||
        (row.matchedBy !== undefined && (typeof row.matchedBy !== "string" || row.matchedBy.length > 64))) {
      throw new Error("member_suggestions_unavailable");
    }
    return {
      id: row.id,
      x_name: row.x_name,
      ...(typeof row.score === "number" ? { score: row.score } : {}),
      ...(typeof row.matchedBy === "string" ? { matchedBy: row.matchedBy } : {}),
    };
  });
  return {
    items,
    hasMore: value.hasMore as boolean,
    nextOffset: value.nextOffset as number | null,
    hint: value.hint as string | null,
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
