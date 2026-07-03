import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  countPublicVideos,
  fetchPublicVideos,
  parsePublicVideoSort,
} from "@/lib/db/listQueries";
import { events as eventsTable } from "@/lib/db/schema";
import { VideoCard } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { formatUnix } from "@/lib/utils/format";
import { buildPageMetadata } from "@/lib/seo";
import { extractYoutubeId, youtubeThumbUrl } from "@/lib/youtube/id";
import { loadStaticRecentVideosPage } from "@/lib/publicData/staticRecentVideos";

export const metadata: Metadata = buildPageMetadata({
  title: "作品一覧",
  description: "FlameNodeに投稿された公開作品を、新着順やスコア順で探せます。",
  path: "/list",
});

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  sort?: string;
  page?: string;
  event?: string;
  view?: string;
}

const PAGE_SIZE = 24;
const LIST_HREF = "/list";

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const {
    q = "",
    sort = "new",
    page = "1",
    event = "",
    view: rawView = "grid",
  } = await searchParams;
  const view = rawView === "index" ? "index" : "grid";
  const parsedSort = parsePublicVideoSort(sort);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const staticData =
    !q.trim() && parsedSort === "new" && !event
      ? await loadStaticRecentVideosPage({ page: pageNum, pageSize: PAGE_SIZE })
      : null;

  const data = staticData
    ? { videos: staticData.videos, total: staticData.total, eventInfo: null }
    : await withDatabase(async (db) => {
        const [videos, total, eventInfo] = await Promise.all([
          fetchPublicVideos(db, {
            q,
            sort: parsedSort,
            eventId: event || undefined,
            limit: PAGE_SIZE,
            offset,
          }),
          countPublicVideos(db, {
            q,
            eventId: event || undefined,
          }),
          event
            ? db
                .select({
                  id: eventsTable.id,
                  title: eventsTable.title,
                })
                .from(eventsTable)
                .where(eq(eventsTable.id, event))
                .limit(1)
                .then((rows) => rows[0] ?? null)
            : Promise.resolve(null),
        ]);
        return { videos, total, eventInfo };
      });

  const { videos = [], total = 0, eventInfo = null } = data ?? {};

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const params = (override: Partial<SearchParams> = {}) => {
    const p = new URLSearchParams();
    const merged = { q, sort, page, event, view, ...override };
    if (merged.q) p.set("q", merged.q);
    if (merged.sort && merged.sort !== "new") p.set("sort", merged.sort);
    if (merged.event) p.set("event", merged.event);
    if (merged.view && merged.view !== "grid") p.set("view", merged.view);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    return p.toString();
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
        <header className="fn-page-head fn-page-head--split">
          <div className="fn-page-head-main">
            <span className="fn-eyebrow">
              archive — {total.toLocaleString()} works
            </span>
            <h1 className="fn-display fn-page-title">作品一覧</h1>
          </div>
          <div className="fn-cr-controls" aria-label="表示形式">
            <div className="fn-cr-segment fn-cr-segment--icon-only">
              <Link
                href={`/list?${params({ view: "grid", page: "1" })}`}
                className={`fn-cr-seg-btn ${view === "grid" ? "is-active" : ""}`}
                aria-current={view === "grid" ? "page" : undefined}
                aria-label="タイル表示"
              >
                <Icon name="grid" size={14} aria-hidden />
              </Link>
              <Link
                href={`/list?${params({ view: "index", page: "1" })}`}
                className={`fn-cr-seg-btn ${view === "index" ? "is-active" : ""}`}
                aria-current={view === "index" ? "page" : undefined}
                aria-label="一覧表示"
              >
                <Icon name="list" size={14} aria-hidden />
              </Link>
            </div>
          </div>
        </header>

        <form className="fn-list-toolbar" method="get">
          <label className="fn-list-search">
            <Icon name="search" size={14} aria-hidden />
            <span className="fn-sr-only">検索キーワード</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="作品名 / 作者 / 楽曲 / コメント など"
              autoComplete="off"
            />
          </label>
          <input type="hidden" name="view" value={view} />
          <div className={styles.controlsGroup}>
            <span className="fn-list-toolbar-label">並び替え</span>
            <AutoSubmitSelect className="fn-select" name="sort" defaultValue={sort}>
              <option value="new">新着順</option>
              <option value="old">古い順</option>
              <option value="score">おすすめ順</option>
            </AutoSubmitSelect>
          </div>
          {event ? <input type="hidden" name="event" value={event} /> : null}
          {q || sort !== "new" || event ? (
            <Link href={LIST_HREF} className="fn-btn fn-btn-ghost">
              リセット
            </Link>
          ) : null}
        </form>

        {event ? (
        <div className="fn-filter-bar" aria-label="現在のフィルター">
          <span className="fn-badge fn-badge-soft">
            イベント{" "}
            {eventInfo ? (
              <Link href={`/event/${eventInfo.id}`}>
                {eventInfo.title}
              </Link>
            ) : (
              event
            )}
          </span>
          <Link
            href={`/list?${params({ event: "", page: "1" })}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            イベント絞り込みを解除
          </Link>
        </div>
        ) : null}

        {videos.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={24} aria-hidden />
          <p className="fn-empty-message">
            条件に合う作品が見つかりませんでした。条件を変えてお試しください。
          </p>
        </div>
      ) : (
        <>
          {view === "grid" ? (
            <div className="fn-list-grid">
              {videos.map((v, index) => (
                <div key={`${v.id}-list-${index}`} className={styles.gridItem}>
                  <VideoCard video={v} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="fn-scroll-hint">横にスクロールできます</p>
              <div className={`fn-table-scroll fn-scroll-affordance ${styles.indexWrap}`}>
              <table className={`fn-list-tbl ${styles.indexTable}`}>
                <thead>
                  <tr>
                    <th className={styles.thumbCol} />
                    <th>Title</th>
                    <th>Creator</th>
                    <th>Event</th>
                    <th>Posted</th>
                    <th aria-label="open" />
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v, index) => {
                    const href = `/${v.youtube_video_id ?? v.id}`;
                    const youtubeId = v.youtube_video_id ? extractYoutubeId(v.youtube_video_id) : null;
                    return (
                      <tr key={`${v.id}-index-${index}`}>
                        <td className={styles.thumbCell}>
                          {youtubeId ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={youtubeThumbUrl(youtubeId, "mqdefault")}
                              alt=""
                              className={styles.thumbImg}
                              loading="lazy"
                            />
                          ) : (
                            <span className={styles.thumbFallback}>
                              <Icon name="play" size={14} aria-hidden />
                            </span>
                          )}
                        </td>
                        <td>
                          <Link
                            href={href}
                            className={`fn-list-tbl-title ${styles.indexTitle}`}
                            prefetch={false}
                          >
                            {v.title}
                          </Link>
                        </td>
                        <td className={styles.indexCreator}>{v.display_name}</td>
                        <td className={styles.codeCell}>{v.primary_event_id ?? "-"}</td>
                        <td className={styles.codeCell}>
                          {formatUnix(v.scheduled_time, { dateOnly: true })}
                        </td>
                        <td className={styles.arrowCell}>
                          <Link href={href} aria-label={`${v.title}を開く`} prefetch={false}>
                            <Icon name="chevron-right" size={13} aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
          <Pagination
            currentPage={pageNum}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            buildHref={(nextPage) => `/list?${params({ page: String(nextPage) })}`}
          />
        </>
        )}
    </div>
  );
}
