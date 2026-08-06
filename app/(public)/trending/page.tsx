import * as React from "react";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { RankedVideoCard } from "@/components/video/RankedVideoCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatUnix } from "@/lib/utils/format";
import { buildPageMetadata } from "@/lib/seo";
import {
  PublicDataUnavailableNotice,
  setPublicRequestRoute,
} from "@/lib/publicData/loader";
import { loadStaticTrending } from "@/lib/publicData/trendingLoader";

export const metadata: Metadata = buildPageMetadata({
  path: "/trending",
  title: "急上昇ランキング",
  description:
    "FlameNode内で最近よく視聴されている作品のランキングです。",
});

export const dynamic = "force-dynamic";

const TRENDING_PAGE_LIMIT = 30;

export default async function TrendingPage(): Promise<React.ReactElement> {
  setPublicRequestRoute("/trending");
  const trending = await loadStaticTrending();
  const items = trending.data?.items.slice(0, TRENDING_PAGE_LIMIT) ?? [];
  const generatedAt = trending.data?.generatedAt ?? null;

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <span className="fn-eyebrow">trending</span>
        <h1 className="fn-display fn-page-title">急上昇ランキング</h1>
        <p className="fn-muted fn-text-sm fn-section-subtitle">
          FlameNode内の視聴イベント（10秒以上）を集計し、直近2日間の視聴急増で順位付けしています。各作品に1週間の視聴回数を表示しています。
        </p>
      </header>

      {generatedAt != null ? (
        <p className={styles.updatedAt} role="status">
          最終更新（JST）: {formatUnix(generatedAt)}
        </p>
      ) : null}

      {trending.stale ? (
        <p className={styles.notice} role="status">
          ランキングデータが古い可能性があります。しばらくしてから再度ご確認ください。
        </p>
      ) : null}

      {trending.state === "unavailable" ? (
        <PublicDataUnavailableNotice />
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="ランキングを準備中です"
            description="視聴データの集計が完了すると、ここに急上昇作品が表示されます。"
          />
        </div>
      ) : (
        <ol className={`fn-list-grid ${styles.list}`} aria-label="急上昇ランキング">
          {items.map((item, index) => (
            <li key={item.id} className={styles.row}>
              <RankedVideoCard
                item={item}
                rank={item.rank ?? index + 1}
                showWeeklyViews
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
