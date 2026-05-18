import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import {
  countPublicVideos,
  fetchPublicVideos,
} from "@/lib/db/listQueries";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = {
  title: "作品一覧",
};

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  sort?: string;
  page?: string;
  event?: string;
}

const PAGE_SIZE = 24;

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const { q = "", sort = "new", page = "1", event = "" } = await searchParams;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const data = await withDatabase(async (db) => {
    const [videos, total] = await Promise.all([
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
    ]);
    return { videos, total };
  });

  const { videos = [], total = 0 } = data ?? {};

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const params = (override: Partial<SearchParams> = {}) => {
    const p = new URLSearchParams();
    const merged = { q, sort, page, event, ...override };
    if (merged.q) p.set("q", merged.q);
    if (merged.sort && merged.sort !== "new") p.set("sort", merged.sort);
    if (merged.event) p.set("event", merged.event);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    return p.toString();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>作品一覧</h1>
        <p className={styles.lead}>
          FlameNode に投稿されたすべての公開作品から、観たい一本を探しましょう。
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
          <Link href="/list" className="fn-btn fn-btn-ghost">
            リセット
          </Link>
        ) : null}
      </form>

      {videos.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={24} aria-hidden />
          <p className="fn-empty-message">
            該当する作品が見つかりませんでした。条件を変えてお試しください。
          </p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {videos.map((v) => (
              <div key={v.id} className={styles.gridItem}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
          <nav className={styles.pagination} aria-label="ページネーション">
            {pageNum > 1 ? (
              <Link
                href={`/list?${params({ page: String(pageNum - 1) })}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="chevron-left" size={12} aria-hidden />
                前へ
              </Link>
            ) : null}
            <span className={styles.pageBadge}>
              {pageNum} / {totalPages} ページ ({total} 件)
            </span>
            {pageNum < totalPages ? (
              <Link
                href={`/list?${params({ page: String(pageNum + 1) })}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                次へ
                <Icon name="chevron-right" size={12} aria-hidden />
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
