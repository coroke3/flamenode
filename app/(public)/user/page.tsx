import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, isNull, like, ne, or, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import { videos, xUsers } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import {
  excludePvsfSummaryVideos,
  PVSF_SUMMARY_EVENT_ID,
} from "@/lib/db/queries";
import { publicListableXApprovalWhere } from "@/lib/utils/publicXUserWhere";
import { buildPageMetadata } from "@/lib/seo";
import {
  canFallbackToDatabase,
  loadStaticUsersIndex,
  type StaticUsersIndexEntry,
} from "@/lib/publicData/loader";
import {
  filterUsersIndexItems,
  paginateUsersIndexItems,
  sortUsersIndexItems,
  type UsersIndexSort,
} from "@/lib/publicData/staticUsersIndexCore";

export const metadata: Metadata = buildPageMetadata({
  path: "/user",
  title: "クリエイターを見つける",
});

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  sort?: string;
  page?: string;
}

const PAGE_SIZE = 48;

type CreatorRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  own_count: number;
  collab_count: number;
  total_count: number;
};

function parseUsersIndexSort(value: string | undefined): UsersIndexSort {
  return value === "name" || value === "works" ? value : "score";
}

function mapIndexEntry(entry: StaticUsersIndexEntry): CreatorRow {
  return {
    id: entry.x_id,
    x_name: entry.x_name,
    icon_url: entry.icon_url,
    own_count: entry.personal_count,
    collab_count: entry.collab_count,
    total_count: entry.total_works,
  };
}

async function fetchCreatorsFromDatabase(): Promise<CreatorRow[]> {
  return (
    (await withDatabase(async (db) => {
      const filters = [publicListableXApprovalWhere()];
      const countablePublicVideoAliasV = sql`
        v.visibility_status = 'public'
        AND COALESCE(v.primary_event_id, '') <> ${PVSF_SUMMARY_EVENT_ID}
        AND NOT EXISTS (
          SELECT 1 FROM video_events AS pvsf_summary_video_events
          WHERE pvsf_summary_video_events.video_id = v.id
            AND pvsf_summary_video_events.event_id = ${PVSF_SUMMARY_EVENT_ID}
        )
      `;

      const rows = await db
        .select({
          id: xUsers.id,
          x_name: sql<string>`COALESCE(
          ${xUsers.x_name},
          (SELECT v.creator_display_name FROM videos AS v
           WHERE v.creator_x_user_id = "x_users"."id"
             AND ${countablePublicVideoAliasV}
            ORDER BY v.scheduled_time DESC LIMIT 1),
           "x_users"."id"
         )`,
          icon_url: sql<string | null>`COALESCE(
          ${xUsers.icon_url},
          (SELECT v.creator_icon_url FROM videos AS v
           WHERE v.creator_x_user_id = "x_users"."id"
             AND v.creator_icon_url IS NOT NULL
             AND v.collaboration_type = 'individual'
             AND ${countablePublicVideoAliasV}
            ORDER BY v.scheduled_time DESC LIMIT 1),
          (SELECT v.creator_icon_url FROM videos AS v
           WHERE v.creator_x_user_id = "x_users"."id"
             AND v.creator_icon_url IS NOT NULL
             AND v.collaboration_type = 'collab'
             AND ${countablePublicVideoAliasV}
            ORDER BY v.scheduled_time DESC LIMIT 1)
         )`,
          profile_text: xUsers.profile_text,
          youtube_channel_url: xUsers.youtube_channel_url,
          own_count: sql<number>`(
          SELECT COUNT(DISTINCT v.id)
          FROM videos AS v
          WHERE v.creator_x_user_id = "x_users"."id"
            AND ${countablePublicVideoAliasV}
        )`,
          collab_count: sql<number>`(
          SELECT COUNT(DISTINCT vm.video_id)
          FROM video_members AS vm
          INNER JOIN videos AS v ON v.id = vm.video_id
          WHERE vm.x_user_id = "x_users"."id"
            AND ${countablePublicVideoAliasV}
        )`,
          total_count: sql<number>`(
          SELECT COUNT(DISTINCT v.id)
          FROM videos AS v
          LEFT JOIN video_members AS vm ON vm.video_id = v.id
          WHERE (v.creator_x_user_id = "x_users"."id" OR vm.x_user_id = "x_users"."id")
            AND ${countablePublicVideoAliasV}
        )`,
        })
        .from(xUsers)
        .where(and(...filters)!);

      const orphanRows = await db
        .select({
          id: videos.creator_x_user_id,
          x_name: sql<string>`COALESCE(
          (SELECT v.creator_display_name FROM videos AS v
           WHERE v.creator_x_user_id = ${videos.creator_x_user_id}
             AND ${countablePublicVideoAliasV}
            ORDER BY v.scheduled_time DESC, v.created_at DESC LIMIT 1),
          ${videos.creator_x_user_id}
        )`,
          icon_url: sql<string | null>`COALESCE(
          (SELECT v.creator_icon_url FROM videos AS v
           WHERE v.creator_x_user_id = ${videos.creator_x_user_id}
             AND v.creator_icon_url IS NOT NULL
             AND v.collaboration_type = 'individual'
             AND ${countablePublicVideoAliasV}
           ORDER BY v.scheduled_time DESC, v.created_at DESC LIMIT 1),
          (SELECT v.creator_icon_url FROM videos AS v
           WHERE v.creator_x_user_id = ${videos.creator_x_user_id}
             AND v.creator_icon_url IS NOT NULL
             AND v.collaboration_type = 'collab'
             AND ${countablePublicVideoAliasV}
           ORDER BY v.scheduled_time DESC, v.created_at DESC LIMIT 1)
        )`,
          profile_text: sql<string | null>`NULL`,
          youtube_channel_url: sql<string | null>`NULL`,
          own_count: sql<number>`COUNT(DISTINCT ${videos.id})`,
          collab_count: sql<number>`0`,
          total_count: sql<number>`COUNT(DISTINCT ${videos.id})`,
        })
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
        .where(
          and(
            eq(videos.visibility_status, "public"),
            excludePvsfSummaryVideos(),
            ne(videos.creator_x_user_id, "anonymous"),
            isNull(xUsers.id),
          )!,
        )
        .groupBy(videos.creator_x_user_id);

      return [...rows, ...orphanRows]
        .map((row) => ({
          id: String(row.id ?? ""),
          x_name: row.x_name,
          icon_url: row.icon_url,
          own_count: Number(row.own_count) || 0,
          collab_count: Number(row.collab_count) || 0,
          total_count: Number(row.total_count) || 0,
          profile_text: row.profile_text,
          youtube_channel_url: row.youtube_channel_url,
        }))
        .filter(
          (row) =>
            row.id &&
            (row.total_count > 0 || row.profile_text || row.youtube_channel_url),
        );
    })) ?? []
  );
}

export default async function UserListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const { q = "", sort = "score", page = "1" } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const sortKey = parseUsersIndexSort(sort);
  const staticLoaded = await loadStaticUsersIndex();

  let creators: CreatorRow[];
  if (staticLoaded.index) {
    const filtered = filterUsersIndexItems(staticLoaded.index.items, q);
    const sorted = sortUsersIndexItems(filtered, sortKey);
    creators = sorted.map(mapIndexEntry);
  } else if (canFallbackToDatabase(staticLoaded.strategy)) {
    creators = await fetchCreatorsFromDatabase();
    if (q.trim()) {
      const keyword = q.trim().toLocaleLowerCase();
      creators = creators.filter(
        (creator) =>
          creator.x_name.toLocaleLowerCase().includes(keyword) ||
          creator.id.toLocaleLowerCase().includes(keyword),
      );
    }
    creators.sort((a, b) => {
      if (sortKey === "name") {
        return a.x_name.localeCompare(b.x_name, "ja");
      }
      if (sortKey === "works") {
        return (
          b.total_count - a.total_count ||
          a.x_name.localeCompare(b.x_name, "ja")
        );
      }
      return (
        b.total_count * 2 +
        b.own_count -
        (a.total_count * 2 + a.own_count) ||
        a.x_name.localeCompare(b.x_name, "ja")
      );
    });
  } else {
    creators = [];
  }

  const { total, totalPages, safePage, current } = paginateUsersIndexItems(
    creators,
    pageNum,
    PAGE_SIZE,
  );

  const params = (override: Partial<SearchParams> = {}) => {
    const p = new URLSearchParams();
    const merged = { q, sort, page: String(safePage), ...override };
    if (merged.q) p.set("q", merged.q);
    if (merged.sort && merged.sort !== "score") p.set("sort", merged.sort);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    return p.toString();
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <span className="fn-eyebrow">CREATORS</span>
          <h1 className="fn-display fn-page-title">クリエイターを見つける</h1>
        </div>
      </header>

      <form className={styles.controls} method="get">
        <label className={styles.searchBox}>
          <Icon name="search" size={14} aria-hidden />
          <span className="fn-sr-only">クリエイター検索</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="名前 / X ID"
            autoComplete="off"
          />
        </label>
        <label className={styles.sortBox}>
          <span>並び替え</span>
          <AutoSubmitSelect className="fn-select" name="sort" defaultValue={sort}>
            <option value="score">おすすめ順</option>
            <option value="works">作品数順</option>
            <option value="name">名前順</option>
          </AutoSubmitSelect>
        </label>
        {q || sort !== "score" ? (
          <Link href="/user" className="fn-btn fn-btn-ghost">
            リセット
          </Link>
        ) : null}
      </form>

      {current.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={24} aria-hidden />
          <p className="fn-empty-message">
            条件に合うクリエイターが見つかりませんでした。
          </p>
        </div>
      ) : (
        <>
          <div className={styles.meta}>{total} 件</div>
          <div className={styles.grid}>
            {current.map((creator, index) => (
              <Link
                key={`${creator.id}-creator-${index}`}
                href={`/user/${creator.id}`}
                className={styles.card}
                prefetch={false}
              >
                <span className={styles.profile}>
                  {cachedGoogleImageUrl(creator.icon_url) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cachedGoogleImageUrl(creator.icon_url) ?? ""}
                      alt=""
                      className={styles.avatar}
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.avatarFallback}>
                      <Icon name="user" size={20} aria-hidden />
                    </span>
                  )}
                  <span className={styles.identity}>
                    <span className={styles.name}>{creator.x_name}</span>
                    <span className={styles.handle}>@{creator.id}</span>
                  </span>
                </span>
                <span className={styles.counts}>
                  {creator.total_count} 作品
                  <small>
                    主催 {creator.own_count} / 参加 {creator.collab_count}
                  </small>
                </span>
              </Link>
            ))}
          </div>

          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            buildHref={(nextPage) => `/user?${params({ page: String(nextPage) })}`}
          />
        </>
      )}
    </div>
  );
}
