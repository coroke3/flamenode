import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import { countPublicVideos, fetchPublicVideos } from "@/lib/db/listQueries";
import { events as eventsTable } from "@/lib/db/schema";
import { VideoCard } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "作品一覧",
};

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
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const data = await withDatabase(async (db) => {
    const [videos, total, eventInfo] = await Promise.all([
      fetchPublicVideos(db, {
        q,
        sort: sort as "new" | "old" | "score",
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
    <div className={`fn-public-container ${styles.page}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>作品一覧</h1>
        <p className={styles.lead}>
          FlameNode に投稿された公開作品を、タイトル・作者名・楽曲名から探せます。
        </p>
      </header>

      <form className={styles.controls} method="get">
        <label className={styles.searchBox}>
          <Icon name="search" size={14} aria-hidden />
          <span className="fn-sr-only">検索キーワード</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="作品名 / 作者名 / 楽曲"
            autoComplete="off"
          />
        </label>
        <input type="hidden" name="view" value={view} />
        <div className={styles.controlsGroup}>
          <span className={styles.controlsLabel}>並び替え</span>
          <select className="fn-select" name="sort" defaultValue={sort}>
            <option value="new">新着順</option>
            <option value="old">古い順</option>
            <option value="score">おすすめ順</option>
          </select>
        </div>
        {event ? <input type="hidden" name="event" value={event} /> : null}
        <button type="submit" className="fn-btn fn-btn-primary">
          適用
        </button>
        {q || sort !== "new" || event ? (
          <a href={LIST_HREF} className="fn-btn fn-btn-ghost">
            リセット
          </a>
        ) : null}
      </form>

      <div className={styles.viewSwitch} aria-label="表示形式">
        <Link
          href={`/list?${params({ view: "grid", page: "1" })}`}
          className={view === "grid" ? styles.viewButtonActive : styles.viewButton}
          aria-current={view === "grid" ? "page" : undefined}
        >
          <Icon name="grid" size={12} aria-hidden />
          Tile
        </Link>
        <Link
          href={`/list?${params({ view: "index", page: "1" })}`}
          className={view === "index" ? styles.viewButtonActive : styles.viewButton}
          aria-current={view === "index" ? "page" : undefined}
        >
          <Icon name="list" size={12} aria-hidden />
          Index
        </Link>
      </div>

      {event ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 8,
            fontSize: 13,
          }}
          aria-label="現在のフィルター"
        >
          <span className="fn-badge fn-badge-soft">
            イベント{" "}
            {eventInfo ? (
              <Link
                href={`/event/${eventInfo.id}`}
                style={{ textDecoration: "underline" }}
              >
                {eventInfo.title}
              </Link>
            ) : (
              event
            )}
          </span>
          <a
            href={`/list?${params({ event: "", page: "1" })}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            イベント絞り込みを解除
          </a>
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
            <div className={styles.grid}>
              {videos.map((v, index) => (
                <div key={`${v.id}-list-${index}`} className={styles.gridItem}>
                  <VideoCard video={v} />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.indexWrap}>
              <table className={styles.indexTable}>
                <thead>
                  <tr>
                    <th>Code</th>
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
                    return (
                      <tr key={`${v.id}-index-${index}`}>
                        <td className={styles.codeCell}>{v.youtube_video_id ?? v.id}</td>
                        <td>
                          <Link href={href} className={styles.indexTitle} prefetch={false}>
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
          )}
          <nav className={styles.pagination} aria-label="ページネーション">
            {pageNum > 1 ? (
              <a
                href={`/list?${params({ page: String(pageNum - 1) })}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="chevron-left" size={12} aria-hidden />
                前へ
              </a>
            ) : null}
            <span className={styles.pageBadge}>
              {pageNum} / {totalPages} ページ ({total} 件)
            </span>
            {pageNum < totalPages ? (
              <a
                href={`/list?${params({ page: String(pageNum + 1) })}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                次へ
                <Icon name="chevron-right" size={12} aria-hidden />
              </a>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
