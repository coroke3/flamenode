export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRouteUser } from "@/lib/auth/routeGuard";
import { getEnv } from "@/lib/cloudflare";
import { searchMemberSuggestions } from "@/lib/video/memberSuggestionSearch";
import { loadMemberSuggestionsIndexFromBucket } from "@/lib/video/memberSuggestionsLoader";
import { loadMemberSuggestionsCandidatesV2FromBucket } from "@/lib/video/memberSuggestionsV2Loader";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OFFSET = 5000;
const MAX_QUERY_LENGTH = 64;
const MIN_SEARCH_CHARS = 2;
const INDEX_LOAD_TIMEOUT_MS = 2500;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;
const UNAVAILABLE_HEADERS = {
  ...PRIVATE_HEADERS,
  "Retry-After": "3",
} as const;

function compactSearchChars(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "");
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

/**
 * 合作メンバーX ID候補検索。
 *
 * D1はrequest pathで読まない。通常はquery gramに対応するV2 postingだけを読み、
 * V2が未生成/破損/世代不一致の移行期間だけcanonical V1 indexへfallbackする。
 * V2の明示的query budget超過時はV1全件scanへ戻らず、入力追加を促して1102を防ぐ。
 */
export async function GET(
  request: Request,
): Promise<Response> {
  const userGuard = await requireRouteUser();
  if (!userGuard.ok) {
    return NextResponse.json(
      { error: userGuard.error },
      { status: userGuard.status, headers: PRIVATE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const rawQuery = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const onlyApproved = url.searchParams.get("onlyApproved") === "1";

  const limitValue = Number(url.searchParams.get("limit") ?? "");
  const limit =
    Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(Math.floor(limitValue), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const offsetValue = Number(url.searchParams.get("offset") ?? "");
  const offset =
    Number.isFinite(offsetValue) && offsetValue > 0
      ? Math.min(Math.floor(offsetValue), MAX_OFFSET)
      : 0;

  const normalizedQueryForMinLength = rawQuery
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^[^\p{L}\p{N}_]+/u, "");

  if (!rawQuery) {
    return NextResponse.json(
      {
        items: [],
        query: rawQuery,
        limit,
        offset,
        nextOffset: null,
        hasMore: false,
        hint: null,
      },
      { headers: PRIVATE_HEADERS },
    );
  }

  if (compactSearchChars(normalizedQueryForMinLength).length < MIN_SEARCH_CHARS) {
    return NextResponse.json(
      {
        items: [],
        query: rawQuery,
        limit,
        offset,
        nextOffset: null,
        hasMore: false,
        hint: "search_too_short",
      },
      { headers: PRIVATE_HEADERS },
    );
  }

  try {
    let bucket: Pick<R2Bucket, "get">;
    try {
      bucket = getEnv().BUCKET;
    } catch (error) {
      console.warn("[x-users-search] bucket binding unavailable", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return NextResponse.json(
        { error: "suggestions_unavailable" },
        { status: 503, headers: UNAVAILABLE_HEADERS },
      );
    }

    const v2 = await withIndexTimeout(
      loadMemberSuggestionsCandidatesV2FromBucket(bucket, rawQuery),
    );

    let searchItems;
    let sourceTruncated = false;
    let source: "v2" | "v1" = "v2";

    if (v2.ok) {
      searchItems = v2.items;
      sourceTruncated = v2.truncated;
    } else if (v2.reason === "query_budget_exceeded") {
      return NextResponse.json(
        {
          items: [],
          query: rawQuery,
          limit,
          offset,
          nextOffset: null,
          hasMore: true,
          hint: "候補が多いため、名前またはX IDを追加で入力してください。",
        },
        { headers: PRIVATE_HEADERS },
      );
    } else {
      source = "v1";
      const loaded = await withIndexTimeout(
        loadMemberSuggestionsIndexFromBucket(bucket),
      );
      if (!loaded.ok) {
        console.warn("[x-users-search] suggestions unavailable", {
          v2_reason: v2.reason,
          v1_reason: loaded.reason,
        });
        return NextResponse.json(
          { error: "suggestions_unavailable" },
          { status: 503, headers: UNAVAILABLE_HEADERS },
        );
      }
      searchItems = loaded.items;
    }

    const result = searchMemberSuggestions(searchItems, {
      query: rawQuery,
      limit,
      offset,
      onlyApproved,
    });
    const hasMore = result.hasMore || sourceTruncated;

    return NextResponse.json(
      {
        items: result.items.map((item) => ({
          id: item.x_user_id,
          x_name: item.name,
          score: item.score,
          matchedBy: item.matchedBy,
        })),
        query: rawQuery,
        limit,
        offset,
        nextOffset: result.nextOffset,
        hasMore,
        hint: hasMore
          ? "候補が多いため、名前またはX IDを追加で入力してください。"
          : null,
        source,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error("[x-users-search] suggestion lookup failed", error);
    return NextResponse.json(
      { error: "suggestions_unavailable" },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
