import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { VideoCard } from "@/components/video/VideoCard";
import type { VideoCardData } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { TableScroll } from "@/components/ui/TableScroll";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { ImeSafeGetForm } from "@/components/forms/ImeSafeGetForm";
import { formatUnix } from "@/lib/utils/format";
import { buildPageMetadata } from "@/lib/seo";
import { extractYoutubeId, youtubeThumbUrl } from "@/lib/youtube/id";
import { parsePublicVideoSort } from "@/lib/db/listQueries";
import { loadStaticRecentVideosPage, loadStaticPopularVideosPage, loadStaticSearchVideosPage, loadPublicEventVideosPage, setPublicRequestRoute } from "@/lib/publicData/loader";

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
  const view =
    rawView === "index" ? "index" : rawView === "compact" ? "compact" : "grid";
  const parsedSort = parsePublicVideoSort(sort);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  setPublicRequestRoute("/list");

  const staticRecentLoad =
    !q.trim() && parsedSort === "new" && !event
      ? await loadStaticRecentVideosPage({
          page: pageNum,
          pageSize: PAGE_SIZE,
          q,
          sort: "new",
        })
      : null;
  const staticOldLoad =
    !q.trim() && parsedSort === "old" && !event
      ? await loadStaticRecentVideosPage({
          page: pageNum,
          pageSize: PAGE_SIZE,
          sort: "old",
        })
      : null;
  const staticPopularLoad =
    !q.trim() && parsedSort === "score" && !event
      ? await loadStaticPopularVideosPage({ page: pageNum, pageSize: PAGE_SIZE })
      : null;
  const staticSearchLoad =
    q.trim() && !event
      ? await loadStaticSearchVideosPage({
          q,
          sort: parsedSort,
          page: pageNum,
          pageSize: PAGE_SIZE,
        })
      : null;
  const eventListLoad =
    event.trim()
      ? await loadPublicEventVideosPage({
          eventId: event.trim(),
          sort: parsedSort,
          page: pageNum,
          pageSize: PAGE_SIZE,
          q,
        })
      : null;
  const staticLoad =
    staticPopularLoad ?? staticSearchLoad ?? staticOldLoad ?? staticRecentLoad;

  const data: {
    videos: VideoCardData[];
    total: number;
    eventInfo: { id: string; title: string } | null;
  } = eventListLoad?.page
    ? {
        videos: eventListLoad.page.videos,
        total: eventListLoad.page.total,
        eventInfo: eventListLoad.eventInfo,
      }
    : staticLoad?.page
      ? {
          videos: staticLoad.page.videos,
          total: staticLoad.page.total,
          eventInfo: null,
        }
      : { videos: [] as VideoCardData[], total: 0, eventInfo: null };

  const { videos = [], total = 0, eventInfo = null } = data ?? {};
  const listUnavailable =
    event.trim() &&
    eventListLoad != null &&
    eventListLoad.mode === "unavailable";

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
  const activeFilterCount = [q.trim(), sort !== "new" ? sort : "", event].filter(Boolean).length;

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
        <header className="fn-page-head fn-page-head--split">
          <div className="fn-page-head-main">
            <span className="fn-eyebrow">ARCHIVE</span>
            <h1 className="fn-display fn-page-title">作品一覧</h1>
            <p className="fn-page-lead">{`${total.toLocaleString()} works`}</p>
          </div>
          <div className="fn-cr-controls" aria-label="表示形式">
            <div className="fn-cr-segment fn-cr-segment--icon-only">
              <Link
                href={`/list?${params({ view: "grid", page: "1" })}`}
                className={`fn-cr-seg-btn ${view === "grid" ? "is-active" : ""}`}
                aria-current={view === "grid" ? "page" : undefined}
                aria-label="タイル表示"
                title="タイル表示"
              >
                <Icon name="grid" size={14} aria-hidden />
                <span className={styles.viewLabel}>
                  タイル
                </span>
              </Link>
              <Link
                href={`/list?${params({ view: "compact", page: "1" })}`}
                className={`fn-cr-seg-btn ${view === "compact" ? "is-active" : ""}`}
                aria-current={view === "compact" ? "page" : undefined}
                aria-label="コンパクト表示"
                title="コンパクト表示"
              >
                <Icon name="compact" size={14} aria-hidden />
                <span className={styles.viewLabel}>
                  コンパクト
                </span>
              </Link>
              <Link
                href={`/list?${params({ view: "index", page: "1" })}`}
                className={`fn-cr-seg-btn ${view === "index" ? "is-active" : ""}`}
                aria-current={view === "index" ? "page" : undefined}
                aria-label="一覧表示"
                title="一覧表示"
              >
                <Icon name="list" size={14} aria-hidden />
                <span className={styles.viewLabel}>
                  一覧
                </span>
              </Link>
            </div>
          </div>
        </header>

        <details className={styles.mobileFilterPanel} open>
          <summary>
            <span>絞り込み</span>
            <span className={styles.filterSummaryMeta}>
              {activeFilterCount > 0 ? `${activeFilterCount}件適用中` : "条件なし"}
            </span>
          </summary>
          <ImeSafeGetForm className="fn-list-toolbar" method="get">
            <label className="fn-list-search">
              <Icon name="search" size={14} aria-hidden />
              <span className="fn-sr-only">検索キーワード</span>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="作品を検索"
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
            {activeFilterCount > 0 ? (
              <Link href={LIST_HREF} className="fn-btn fn-btn-ghost">
                リセット
              </Link>
            ) : null}
          </ImeSafeGetForm>
        </details>

        {activeFilterCount > 0 ? (
          <div className={styles.activeFilters} aria-label="適用中のフィルター">
            <span className={styles.activeFiltersLabel}>適用中</span>
            {q.trim() ? (
              <Link className={styles.activeChip} href={`/list?${params({ q: "", page: "1" })}`}>
                検索: {q.trim()}
                <span aria-hidden>×</span>
              </Link>
            ) : null}
            {sort !== "new" ? (
              <Link className={styles.activeChip} href={`/list?${params({ sort: "new", page: "1" })}`}>
                並び順: {sort === "old" ? "古い順" : "おすすめ順"}
                <span aria-hidden>×</span>
              </Link>
            ) : null}
            {event ? (
              <Link className={styles.activeChip} href={`/list?${params({ event: "", page: "1" })}`}>
                イベント: {eventInfo?.title ?? event}
                <span aria-hidden>×</span>
              </Link>
            ) : null}
          </div>
        ) : null}

        {videos.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={24} aria-hidden />
          <p className="fn-empty-message">
            {listUnavailable
              ? "このイベントの作品一覧を一時的に表示できません。"
              : "条件に合う作品が見つかりませんでした。条件を変えてお試しください。"}
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
          ) : view === "compact" ? (
            <div className={`fn-list-compact ${styles.compactGrid}`}>
              {videos.map((v, index) => (
                <div key={`${v.id}-compact-${index}`} className={styles.compactItem}>
                  <VideoCard video={v} size="compact" />
                </div>
              ))}
            </div>
          ) : (
            <TableScroll className={styles.indexWrap}>
              <table className={`fn-list-tbl ${styles.indexTable}`}>
                <thead>
                  <tr>
                    <th className={styles.thumbCol} />
                    <th>作品</th>
                    <th>クリエイター</th>
                    <th>イベント</th>
                    <th>公開日</th>
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
                        <td className={styles.eventCell}>
                          {v.primary_event_id ? (
                            <Link
                              href={`/event/${encodeURIComponent(
                                v.primary_event_id,
                              )}`}
                            >
                              {(v as { primary_event_title?: string | null }).primary_event_title ?? "イベント"}
                            </Link>
                          ) : (
                            <span aria-label="イベントなし">
                              —
                            </span>
                          )}
                        </td>
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
            </TableScroll>
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
