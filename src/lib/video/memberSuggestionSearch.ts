import {
  prefilterMemberSuggestionCandidates,
  rankMemberSuggestionCandidates,
} from "./memberSuggestionRank.ts";
import type { MemberSuggestionItem } from "./memberSuggestionsCore.ts";

export interface MemberSuggestionSearchParams {
  query: string;
  limit: number;
  offset: number;
  onlyApproved?: boolean;
  nowSec?: number;
}

export interface MemberSuggestionSearchResult<T = MemberSuggestionItem> {
  items: Array<{
    x_user_id: string;
    name: string;
    score: number;
    matchedBy: string;
  }>;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * R2 index itemsからautocomplete候補を検索する純関数。
 * routeはこの関数だけに依存し、D1へは一切触れない。
 */
export function searchMemberSuggestions<T extends MemberSuggestionItem>(
  items: readonly T[],
  params: MemberSuggestionSearchParams,
): MemberSuggestionSearchResult<T> {
  const { query, limit, offset, onlyApproved = false, nowSec } = params;
  if (!query.trim()) {
    return { items: [], hasMore: false, nextOffset: null };
  }

  const candidates = onlyApproved
    ? items.filter((item) => item.approvalStatus === "approved")
    : items;

  // 全件rankは重いため、包含一致またはfuzzy長さ窓の候補へ先に絞る。
  const prefiltered = prefilterMemberSuggestionCandidates(candidates, query);
  const ranked = rankMemberSuggestionCandidates(prefiltered, query, nowSec);
  const page = ranked.slice(offset, offset + limit);
  const hasMore = ranked.length > offset + page.length;
  return {
    items: page.map((item) => ({
      x_user_id: item.x_user_id,
      name: item.name,
      score: item.score,
      matchedBy: item.matchedBy,
    })),
    hasMore,
    nextOffset: hasMore ? offset + page.length : null,
  };
}
