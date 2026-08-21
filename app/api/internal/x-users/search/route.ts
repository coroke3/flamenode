export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRouteUser } from "@/lib/auth/routeGuard";
import { getEnv } from "@/lib/cloudflare";
import { searchMemberSuggestions } from "@/lib/video/memberSuggestionSearch";
import { loadMemberSuggestionsIndexFromBucket } from "@/lib/video/memberSuggestionsLoader";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OFFSET = 5000;
const MAX_QUERY_LENGTH = 64;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function compactSearchChars(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "");
}

/**
 * 合作メンバーX ID候補検索。
 *
 * データソースはstatic rebuildが生成するR2 indexのみ。request pathでD1を
 * 一切読まない（fallbackも存在しない）。R2 miss / 不正artifact時は安定した
 * error codeを返し、利用者は手入力で合作メンバーを入力できる。
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

  // 空queryはR2にもD1にも触れない。
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
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    const loaded = await loadMemberSuggestionsIndexFromBucket(bucket);
    if (!loaded.ok) {
      console.warn("[x-users-search] suggestions unavailable", { reason: loaded.reason });
      return NextResponse.json(
        { error: "suggestions_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }

    const normalizedQueryForLength = rawQuery
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/^[＠@]+/, "");
    if (compactSearchChars(normalizedQueryForLength).length < 1) {
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

    const result = searchMemberSuggestions(loaded.items, {
      query: rawQuery,
      limit,
      offset,
      onlyApproved,
    });
    const hasMore = result.hasMore;

    return NextResponse.json(
      {
        // 既存のVideoMembersFieldが利用する内部API DTOを維持する。
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
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error("[x-users-search] suggestion lookup failed", error);
    return NextResponse.json(
      { error: "suggestions_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
