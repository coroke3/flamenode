export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRouteUser } from "@/lib/auth/routeGuard";
import { getEnv } from "@/lib/cloudflare";
import { searchMemberSuggestions } from "@/lib/video/memberSuggestionSearch";
import { loadMemberSuggestionsIndexFromBucket } from "@/lib/video/memberSuggestionsLoader";
import { loadMemberSuggestionsCandidatesV2FromBucket } from "@/lib/video/memberSuggestionsV2Loader";
import type { MemberSuggestionItem } from "@/lib/video/memberSuggestionsCore";

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
const UNAVAILABLE_HEADERS = {
  ...PRIVATE_HEADERS,
  "Retry-After": "3",
} as const;

function compactSearchChars(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "");
}

function parseBoundedDecimalParam(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const raw = (value ?? "").trim().slice(0, MAX_NUMERIC_PARAM_LENGTH);
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
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

function refineQueryResponse(args: {
  query: string;
  limit: number;
  offset: number;
}): Response {
  return NextResponse.json(
    {
      items: [],
      query: args.query,
      limit: args.limit,
      offset: args.offset,
      nextOffset: null,
      hasMore: true,
      hint: "候補が多いため、名前またはX IDを追加で入力してください。",
      source: "v2",
    },
    { headers: PRIVATE_HEADERS },
  );
}

function searchResponse(args: {
  items: MemberSuggestionItem[];
  query: string;
  limit: number;
  offset: number;
  onlyApproved: boolean;
  source: "v2" | "v1";
}): { response: Response; result: ReturnType<typeof searchMemberSuggestions> } {
  const result = searchMemberSuggestions(args.items, {
    query: args.query,
    limit: args.limit,
    offset: args.offset,
    onlyApproved: args.onlyApproved,
  });
  return {
    result,
    response: NextResponse.json(
      {
        items: result.items.map((item) => ({
          id: item.x_user_id,
          x_name: item.name,
          score: item.score,
          matchedBy: item.matchedBy,
        })),
        query: args.query,
        limit: args.limit,
        offset: args.offset,
        nextOffset: result.nextOffset,
        hasMore: result.hasMore,
        hint: result.hasMore
          ? "候補が多いため、名前またはX IDを追加で入力してください。"
          : null,
        source: args.source,
      },
      { headers: PRIVATE_HEADERS },
    ),
  };
}

/**
 * 合作メンバーX ID候補検索。
 *
 * D1はrequest pathで読まない。通常はquery gramに対応するV2 postingだけを読み、
 * V2が未生成/破損/世代不一致の移行期間だけcanonical V1 indexへfallbackする。
 * V2が候補を切り詰める必要がある広いqueryではpartial順位を返さず入力追加を促す。
 * 3文字以上のfuzzy検索は、V2だけで従来順位を保証できない場合にV1へfallbackする。
 */
export async function GET(request: Request): Promise<Response> {
  const userGuard = await requireRouteUser();
  if (!userGuard.ok) {
    return NextResponse.json(
      { error: userGuard.error },
      { status: userGuard.status, headers: PRIVATE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const rawQuery = (url.searchParams.get("q") ?? "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  const onlyApproved = url.searchParams.get("onlyApproved") === "1";
  const limit = Math.max(
    1,
    parseBoundedDecimalParam(
      url.searchParams.get("limit"),
      DEFAULT_LIMIT,
      MAX_LIMIT,
    ),
  );
  const offset = parseBoundedDecimalParam(
    url.searchParams.get("offset"),
    0,
    MAX_OFFSET,
  );

  const normalizedQueryForMinLength = rawQuery
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^[^\p{L}\p{N}_]+/u, "");
  const compactQueryLength = compactSearchChars(
    normalizedQueryForMinLength,
  ).length;

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

  if (compactQueryLength < MIN_SEARCH_CHARS) {
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

    if (v2.ok) {
      // 切り詰めた候補集合をrankすると上位候補そのものが欠落し得るため、
      // partial resultは返さない。V1全件scanにも戻らずqueryの絞り込みを促す。
      if (v2.truncated) {
        return refineQueryResponse({ query: rawQuery, limit, offset });
      }

      const searched = searchResponse({
        items: v2.items,
        query: rawQuery,
        limit,
        offset,
        onlyApproved,
        source: "v2",
      });

      // 2文字queryではrankerのfuzzy分岐が無効なのでposting集合が完全。
      // 3文字以上では、現在ページが強いexact/prefix/contains候補だけで満杯かつ
      // V2集合内にも次ページがある場合だけ、そのページとhasMoreを確定できる。
      // ちょうどlimit件でV2 hasMore=falseの場合、posting外のfuzzy候補が次ページに
      // 存在し得るためV1へfallbackし、paginationを途中で切らない。
      const v2PageIsComplete =
        compactQueryLength <= 2 ||
        (searched.result.items.length === limit &&
          searched.result.hasMore &&
          searched.result.items.every(
            (item) => !item.matchedBy.startsWith("fuzzy_"),
          ));
      if (v2PageIsComplete) return searched.response;
    } else if (v2.reason === "query_budget_exceeded") {
      return refineQueryResponse({ query: rawQuery, limit, offset });
    }

    const loaded = await withIndexTimeout(
      loadMemberSuggestionsIndexFromBucket(bucket),
    );
    if (!loaded.ok) {
      console.warn("[x-users-search] suggestions unavailable", {
        v2_reason: v2.ok ? "compatibility_fallback" : v2.reason,
        v1_reason: loaded.reason,
      });
      return NextResponse.json(
        { error: "suggestions_unavailable" },
        { status: 503, headers: UNAVAILABLE_HEADERS },
      );
    }

    return searchResponse({
      items: loaded.items,
      query: rawQuery,
      limit,
      offset,
      onlyApproved,
      source: "v1",
    }).response;
  } catch (error) {
    console.error("[x-users-search] suggestion lookup failed", error);
    return NextResponse.json(
      { error: "suggestions_unavailable" },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
