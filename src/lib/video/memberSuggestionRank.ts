export interface MemberSuggestionCandidate {
  x_user_id: string;
  name: string;
  xAliases?: string[];
  nameAliases?: string[];
  occurrenceCount?: number;
  lastSeenAt?: number | null;
}

export interface RankedMemberSuggestion {
  x_user_id: string;
  name: string;
  score: number;
  matchedBy: string;
}

function katakanaToHiragana(value: string): string {
  return value.replace(
    /[\u30A1-\u30F6]/g,
    (character) =>
      String.fromCharCode(
        character.charCodeAt(0) - 0x60,
      ),
  );
}

export function normalizeMemberSearchText(
  value: string,
): string {
  return katakanaToHiragana(
    value
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/^[＠@]+/, "")
      .replace(/\s+/g, " "),
  );
}

function compactSearchText(value: string): string {
  return normalizeMemberSearchText(value).replace(
    /[^\p{L}\p{N}_]+/gu,
    "",
  );
}

function limitedLevenshtein(
  left: string,
  right: string,
  maxDistance: number,
): number {
  if (
    Math.abs(left.length - right.length) >
    maxDistance
  ) {
    return maxDistance + 1;
  }

  let previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (
    let leftIndex = 1;
    leftIndex <= left.length;
    leftIndex += 1
  ) {
    const current = [leftIndex];
    let rowMinimum = current[0];

    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      const cost =
        left[leftIndex - 1] ===
        right[rightIndex - 1]
          ? 0
          : 1;

      const value = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      );

      current.push(value);
      rowMinimum = Math.min(
        rowMinimum,
        value,
      );
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length];
}

function matchScore(
  query: string,
  candidate: MemberSuggestionCandidate,
): { score: number; matchedBy: string } {
  const normalizedQuery =
    normalizeMemberSearchText(query);
  const compactQuery =
    compactSearchText(query);

  const id = normalizeMemberSearchText(
    candidate.x_user_id,
  );
  const name = normalizeMemberSearchText(
    candidate.name,
  );

  const xAliases = (
    candidate.xAliases ?? []
  ).map(normalizeMemberSearchText);

  const nameAliases = (
    candidate.nameAliases ?? []
  ).map(normalizeMemberSearchText);

  const matches: Array<{
    score: number;
    matchedBy: string;
  }> = [];

  if (id === normalizedQuery) {
    matches.push({
      score: 1000,
      matchedBy: "xid_exact",
    });
  }

  if (
    xAliases.some(
      (alias) => alias === normalizedQuery,
    )
  ) {
    matches.push({
      score: 960,
      matchedBy: "xid_alias_exact",
    });
  }

  if (
    normalizedQuery &&
    id.startsWith(normalizedQuery)
  ) {
    matches.push({
      score: 900,
      matchedBy: "xid_prefix",
    });
  }

  if (name === normalizedQuery) {
    matches.push({
      score: 880,
      matchedBy: "name_exact",
    });
  }

  if (
    nameAliases.some(
      (alias) => alias === normalizedQuery,
    )
  ) {
    matches.push({
      score: 840,
      matchedBy: "name_alias_exact",
    });
  }

  if (
    normalizedQuery &&
    name.startsWith(normalizedQuery)
  ) {
    matches.push({
      score: 760,
      matchedBy: "name_prefix",
    });
  }

  if (
    normalizedQuery &&
    id.includes(normalizedQuery)
  ) {
    matches.push({
      score: 700,
      matchedBy: "xid_contains",
    });
  }

  if (
    normalizedQuery &&
    xAliases.some((alias) =>
      alias.includes(normalizedQuery),
    )
  ) {
    matches.push({
      score: 680,
      matchedBy: "xid_alias_contains",
    });
  }

  if (
    normalizedQuery &&
    name.includes(normalizedQuery)
  ) {
    matches.push({
      score: 620,
      matchedBy: "name_contains",
    });
  }

  if (
    normalizedQuery &&
    nameAliases.some((alias) =>
      alias.includes(normalizedQuery),
    )
  ) {
    matches.push({
      score: 600,
      matchedBy: "name_alias_contains",
    });
  }

  if (compactQuery.length >= 3) {
    const targets = [
      compactSearchText(candidate.x_user_id),
      compactSearchText(candidate.name),
      ...xAliases.map(compactSearchText),
      ...nameAliases.map(compactSearchText),
    ].filter(Boolean);

    const minimumDistance = Math.min(
      ...targets.map((target) =>
        limitedLevenshtein(
          compactQuery,
          target,
          2,
        ),
      ),
    );

    if (minimumDistance === 1) {
      matches.push({
        score: 500,
        matchedBy: "fuzzy_1",
      });
    } else if (minimumDistance === 2) {
      matches.push({
        score: 400,
        matchedBy: "fuzzy_2",
      });
    }
  }

  if (matches.length === 0) {
    return {
      score: 0,
      matchedBy: "none",
    };
  }

  matches.sort(
    (left, right) =>
      right.score - left.score,
  );

  return matches[0];
}

export function rankMemberSuggestionCandidates(
  candidates: readonly MemberSuggestionCandidate[],
  query: string,
  nowSec = Math.floor(Date.now() / 1000),
): RankedMemberSuggestion[] {
  const ranked = candidates
    .map((candidate) => {
      const match = matchScore(
        query,
        candidate,
      );

      if (match.score <= 0) return null;

      const occurrenceBonus = Math.min(
        50,
        Math.round(
          Math.log2(
            (candidate.occurrenceCount ?? 0) +
              1,
          ) * 10,
        ),
      );

      const lastSeen = candidate.lastSeenAt;
      const ageDays =
        typeof lastSeen === "number"
          ? Math.max(
              0,
              (nowSec - lastSeen) / 86400,
            )
          : Number.POSITIVE_INFINITY;

      const recencyBonus = Number.isFinite(
        ageDays,
      )
        ? Math.max(
            0,
            Math.round(
              20 * (1 - ageDays / 365),
            ),
          )
        : 0;

      return {
        x_user_id: candidate.x_user_id,
        name: candidate.name,
        score:
          match.score +
          occurrenceBonus +
          recencyBonus,
        matchedBy: match.matchedBy,
      };
    })
    .filter(
      (
        item,
      ): item is RankedMemberSuggestion =>
        item !== null,
    );

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.name.localeCompare(
        right.name,
        "ja",
      ) ||
      left.x_user_id.localeCompare(
        right.x_user_id,
      ),
  );

  return ranked;
}

export function scoreSimpleMemberSuggestion(
  query: string,
  suggestion: {
    name: string;
    x_user_id: string;
  },
): number {
  return (
    rankMemberSuggestionCandidates(
      [
        {
          name: suggestion.name,
          x_user_id:
            suggestion.x_user_id,
        },
      ],
      query,
    )[0]?.score ?? 0
  );
}
