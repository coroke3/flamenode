export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { requireRouteUser } from "@/lib/auth/routeGuard";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoMembers,
  videos,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { escapeLike } from "@/lib/utils/sql";
import {
  normalizeMemberSearchText,
  rankMemberSuggestionCandidates,
  type MemberSuggestionCandidate,
} from "@/lib/video/memberSuggestionRank";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OFFSET = 5000;
const MAX_QUERY_LENGTH = 64;
const SOURCE_LIMIT = 200;
const IN_CLAUSE_SIZE = 80;
const MIN_SEARCH_CHARS = 2;

function likeColumn(column: unknown, term: string) {
  return sql`${column} LIKE ${term} ESCAPE '\\'`;
}

function buildLikePattern(normalized: string): string {
  return `%${escapeLike(normalized)}%`;
}

function compactSearchChars(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "");
}

function chunked<T>(
  values: readonly T[],
  size: number,
): T[][] {
  const chunks: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(index, index + size),
    );
  }

  return chunks;
}

interface CandidateAccumulator
  extends MemberSuggestionCandidate {
  xAliases: string[];
  nameAliases: string[];
  occurrenceCount: number;
  lastSeenAt: number | null;
  approvalStatus: string | null;
}

export async function GET(
  request: Request,
): Promise<Response> {
  const userGuard = await requireRouteUser();
  if (!userGuard.ok) {
    return NextResponse.json(
      { error: userGuard.error },
      { status: userGuard.status },
    );
  }

  const db = getDatabase();
  if (!db) {
    return NextResponse.json(
      { error: "db_unavailable" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const rawQuery = (
    url.searchParams.get("q") ?? ""
  )
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  const onlyApproved =
    url.searchParams.get("onlyApproved") ===
    "1";

  const limitValue = Number(
    url.searchParams.get("limit") ?? "",
  );
  const limit =
    Number.isFinite(limitValue) &&
    limitValue > 0
      ? Math.min(
          Math.floor(limitValue),
          MAX_LIMIT,
        )
      : DEFAULT_LIMIT;

  const offsetValue = Number(
    url.searchParams.get("offset") ?? "",
  );
  const offset =
    Number.isFinite(offsetValue) &&
    offsetValue > 0
      ? Math.min(
          Math.floor(offsetValue),
          MAX_OFFSET,
        )
      : 0;

  if (!rawQuery) {
    const rows = await db
      .select({
        id: xUsers.id,
        x_name: xUsers.x_name,
        approval_status:
          xUsers.approval_status,
      })
      .from(xUsers)
      .where(
        onlyApproved
          ? eq(xUsers.approval_status, "approved")
          : undefined,
      )
      .orderBy(asc(xUsers.x_name))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;

    return NextResponse.json({
      items: rows
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          x_name: row.x_name,
          score: 0,
          matchedBy: "recent",
        })),
      query: rawQuery,
      limit,
      offset,
      nextOffset: hasMore
        ? offset + limit
        : null,
      hasMore,
      hint: null,
    });
  }

  const normalizedQuery =
    normalizeMemberSearchText(rawQuery);
  if (compactSearchChars(normalizedQuery).length < MIN_SEARCH_CHARS) {
    return NextResponse.json({
      items: [],
      query: rawQuery,
      limit,
      offset,
      nextOffset: null,
      hasMore: false,
      hint: "search_too_short",
    });
  }

  const directPattern = buildLikePattern(normalizedQuery);

  // 誤字検索用。1文字目が一致する候補も候補集合へ含め、
  // 最終順位はLevenshtein距離で決定する。
  const broadSeed =
    compactSearchChars(normalizedQuery).slice(0, 1) ||
    normalizeXId(rawQuery).slice(0, 1);

  const broadPattern = buildLikePattern(broadSeed);

  const directMatch = or(
    likeColumn(
      sql<string>`lower(${xUsers.id})`,
      directPattern,
    ),
    likeColumn(
      sql<string>`lower(${xUsers.x_name})`,
      directPattern,
    ),
    likeColumn(
      sql<string>`lower(${xUsers.id})`,
      broadPattern,
    ),
    likeColumn(
      sql<string>`lower(${xUsers.x_name})`,
      broadPattern,
    ),
  )!;

  const directRows = await (
    onlyApproved
      ? db
          .select({
            id: xUsers.id,
            x_name: xUsers.x_name,
            approval_status:
              xUsers.approval_status,
          })
          .from(xUsers)
          .where(
            and(
              directMatch,
              eq(
                xUsers.approval_status,
                "approved",
              ),
            )!,
          )
      : db
          .select({
            id: xUsers.id,
            x_name: xUsers.x_name,
            approval_status:
              xUsers.approval_status,
          })
          .from(xUsers)
          .where(directMatch)
  ).limit(SOURCE_LIMIT);

  const aliasRows = await db
    .select({
      x_user_id:
        xUserAliases.x_user_id,
      alias_x_id:
        xUserAliases.alias_x_id,
    })
    .from(xUserAliases)
    .where(
      or(
        likeColumn(
          sql<string>`lower(${xUserAliases.alias_x_id})`,
          directPattern,
        ),
        likeColumn(
          sql<string>`lower(${xUserAliases.alias_x_id})`,
          broadPattern,
        ),
      )!,
    )
    .limit(SOURCE_LIMIT);

  const creatorRows = await db
    .select({
      x_user_id:
        videos.creator_x_user_id,
      name:
        videos.creator_display_name,
      updated_at: videos.updated_at,
    })
    .from(videos)
    .where(
      and(
        sql`${videos.creator_x_user_id} IS NOT NULL`,
        or(
          likeColumn(
            sql<string>`lower(${videos.creator_display_name})`,
            directPattern,
          ),
          likeColumn(
            sql<string>`lower(${videos.creator_x_user_id})`,
            directPattern,
          ),
          likeColumn(
            sql<string>`lower(${videos.creator_display_name})`,
            broadPattern,
          ),
          likeColumn(
            sql<string>`lower(${videos.creator_x_user_id})`,
            broadPattern,
          ),
        )!,
      )!,
    )
    .orderBy(desc(videos.updated_at))
    .limit(SOURCE_LIMIT);

  const memberRows = await db
    .select({
      x_user_id:
        videoMembers.x_user_id,
      name: videoMembers.name,
      updated_at: videos.updated_at,
    })
    .from(videoMembers)
    .innerJoin(
      videos,
      eq(
        videoMembers.video_id,
        videos.id,
      ),
    )
    .where(
      and(
        sql`${videoMembers.x_user_id} IS NOT NULL`,
        or(
          likeColumn(
            sql<string>`lower(${videoMembers.name})`,
            directPattern,
          ),
          likeColumn(
            sql<string>`lower(${videoMembers.x_user_id})`,
            directPattern,
          ),
          likeColumn(
            sql<string>`lower(${videoMembers.name})`,
            broadPattern,
          ),
          likeColumn(
            sql<string>`lower(${videoMembers.x_user_id})`,
            broadPattern,
          ),
        )!,
      )!,
    )
    .orderBy(desc(videos.updated_at))
    .limit(SOURCE_LIMIT);

  const candidateIds = Array.from(
    new Set(
      [
        ...directRows.map((row) => row.id),
        ...aliasRows.map(
          (row) => row.x_user_id,
        ),
        ...creatorRows.map(
          (row) => row.x_user_id,
        ),
        ...memberRows.map(
          (row) => row.x_user_id,
        ),
      ]
        .map((id) => normalizeXId(id))
        .filter(Boolean),
    ),
  );

  const profileRows = [...directRows];
  const loadedProfileIds = new Set(
    directRows.map((row) =>
      row.id.toLowerCase(),
    ),
  );

  for (const ids of chunked(
    candidateIds.filter(
      (id) =>
        !loadedProfileIds.has(
          id.toLowerCase(),
        ),
    ),
    IN_CLAUSE_SIZE,
  )) {
    const rows = await db
      .select({
        id: xUsers.id,
        x_name: xUsers.x_name,
        approval_status:
          xUsers.approval_status,
      })
      .from(xUsers)
      .where(inArray(xUsers.id, ids));

    profileRows.push(...rows);
  }

  const candidates = new Map<
    string,
    CandidateAccumulator
  >();

  const ensureCandidate = (
    rawId: string | null,
  ): CandidateAccumulator | null => {
    const id = normalizeXId(rawId);
    if (!id) return null;

    const existing = candidates.get(id);
    if (existing) return existing;

    const created: CandidateAccumulator = {
      x_user_id: id,
      name: `@${id}`,
      xAliases: [],
      nameAliases: [],
      occurrenceCount: 0,
      lastSeenAt: null,
      approvalStatus: null,
    };

    candidates.set(id, created);
    return created;
  };

  for (const profile of profileRows) {
    const candidate =
      ensureCandidate(profile.id);
    if (!candidate) continue;

    candidate.name =
      profile.x_name || `@${profile.id}`;
    candidate.approvalStatus =
      profile.approval_status;
  }

  for (const alias of aliasRows) {
    const candidate = ensureCandidate(
      alias.x_user_id,
    );
    if (!candidate) continue;

    if (
      !candidate.xAliases.includes(
        alias.alias_x_id,
      )
    ) {
      candidate.xAliases.push(
        alias.alias_x_id,
      );
    }
  }

  for (const history of creatorRows) {
    const candidate = ensureCandidate(
      history.x_user_id,
    );
    if (!candidate) continue;

    if (
      history.name &&
      history.name !== candidate.name &&
      !candidate.nameAliases.includes(
        history.name,
      )
    ) {
      candidate.nameAliases.push(
        history.name,
      );
    }

    candidate.occurrenceCount += 1;
    candidate.lastSeenAt = Math.max(
      candidate.lastSeenAt ?? 0,
      history.updated_at,
    );
  }

  for (const history of memberRows) {
    const candidate = ensureCandidate(
      history.x_user_id,
    );
    if (!candidate) continue;

    if (
      history.name &&
      history.name !== candidate.name &&
      !candidate.nameAliases.includes(
        history.name,
      )
    ) {
      candidate.nameAliases.push(
        history.name,
      );
    }

    candidate.occurrenceCount += 1;
    candidate.lastSeenAt = Math.max(
      candidate.lastSeenAt ?? 0,
      history.updated_at,
    );
  }

  const ranked =
    rankMemberSuggestionCandidates(
      Array.from(candidates.values()).filter(
        (candidate) =>
          !onlyApproved ||
          candidate.approvalStatus ===
            "approved",
      ),
      rawQuery,
    );

  const page = ranked.slice(
    offset,
    offset + limit,
  );
  const hasMore =
    ranked.length > offset + page.length;

  return NextResponse.json(
    {
      items: page.map((item) => ({
        id: item.x_user_id,
        x_name: item.name,
        score: item.score,
        matchedBy: item.matchedBy,
      })),
      query: rawQuery,
      limit,
      offset,
      nextOffset: hasMore
        ? offset + page.length
        : null,
      hasMore,
      hint: hasMore
        ? "候補が多いため、名前またはX IDを追加で入力してください。"
        : null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
