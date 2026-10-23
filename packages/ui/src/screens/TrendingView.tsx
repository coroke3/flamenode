import React from "react";
import { Image, Link } from "../adapters/index.js";
import { EmptyState } from "../feedback/EmptyState.js";
import { cx } from "../cx.js";
import { ScreenIcon } from "./parts.js";

/*
 * `/trending` from the registered mock `docs/migration/mock/static/Trending.html` (`tr-row` list) with CURRENT
 * `app/(public)/trending/page.tsx` texts. The mock's sparkline and rank-move columns have no CURRENT data
 * (CURRENT shows the 7-day view count only), so they are not drawn.
 */
export interface TrendingRow {
  id: string;
  rank: number;
  href: string;
  title: string;
  thumbnailUrl?: string | null;
  creatorName: string;
  creatorIconUrl?: string | null;
  eventId?: string | null;
  eventTitle?: string | null;
  /** CURRENT `views_7d`. */
  weeklyViews: number;
}

export interface TrendingViewProps {
  items: readonly TrendingRow[];
  /** CURRENT `formatUnix(generatedAt)` (JST). */
  updatedLabel?: string | null;
  /** CURRENT `trending.stale`. */
  stale?: boolean;
  className?: string;
}

export function TrendingView({ items, updatedLabel, stale, className }: TrendingViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap tr-wrap">
        <header className="stack tr-head">
          <p className="t-label muted">trending</p>
          <h1 className="t-display">急上昇ランキング</h1>
          <p className="muted t-sm">
            FlameNode内の視聴イベント（10秒以上）を集計し、直近2日間の視聴急増で順位付けしています。各作品に1週間の視聴回数を表示しています。
          </p>
        </header>

        {updatedLabel ? (
          <p className="t-sm muted tr-note" role="status">
            最終更新（JST）: {updatedLabel}
          </p>
        ) : null}
        {stale ? (
          <p className="t-sm muted tr-note" role="status">
            ランキングデータが古い可能性があります。しばらくしてから再度ご確認ください。
          </p>
        ) : null}

        {items.length === 0 ? (
          <div className="tr-empty">
            <EmptyState
              title="ランキングを準備中です"
              description="視聴データの集計が完了すると、ここに急上昇作品が表示されます。"
            />
          </div>
        ) : (
          <ol className="tr-list" aria-label="急上昇ランキング">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="tr-row">
                  <span className="tr-rank t-num">
                    <span className="vh">{item.rank}位</span>
                    <span aria-hidden="true">{String(item.rank).padStart(2, "0")}</span>
                  </span>
                  {item.thumbnailUrl ? (
                    <Image className="tr-thumb" src={item.thumbnailUrl} alt="" />
                  ) : (
                    <span className="tr-thumb tr-thumb-empty" aria-hidden="true"><ScreenIcon name="youtube" /></span>
                  )}
                  <span className="stack tr-body">
                    <span className="tr-title">{item.title}</span>
                    <span className="meta-i t-sm">
                      <span>{item.creatorName}</span>
                      {item.eventTitle ? <span>{item.eventTitle}</span> : null}
                    </span>
                  </span>
                  <span className="t-sm muted t-num tr-views">1週間 {item.weeklyViews.toLocaleString("ja-JP")}回視聴</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
