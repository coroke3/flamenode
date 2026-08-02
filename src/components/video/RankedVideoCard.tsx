import * as React from "react";
import { VideoCard, type VideoCardData } from "./VideoCard";
import styles from "./RankedVideoCard.module.css";
import type { TrendingItem } from "@/lib/publicData/staticTrendingCore";
import { cn } from "@/lib/utils/cn";

export interface RankedVideoCardProps {
  item: TrendingItem;
  rank: number;
  className?: string;
  showWeeklyViews?: boolean;
}

function toVideoCardData(item: TrendingItem): VideoCardData {
  return {
    id: item.id,
    title: item.title,
    youtube_video_id: item.youtube_video_id,
    display_name: item.display_name,
    icon_url: item.icon_url,
    primary_event_id: item.primary_event_id,
    scheduled_time: item.scheduled_time,
    status: item.status,
  };
}

export function RankedVideoCard({
  item,
  rank,
  className,
  showWeeklyViews = false,
}: RankedVideoCardProps): React.ReactElement {
  const weeklyViewsText = showWeeklyViews
    ? `1週間 ${item.views_7d.toLocaleString("ja-JP")}回視聴`
    : null;

  return (
    <article
      className={cn(styles.root, className)}
      aria-label={
        weeklyViewsText != null
          ? `${rank}位 ${item.title} ${weeklyViewsText}`
          : `${rank}位 ${item.title}`
      }
    >
      <div className={styles.cardWrap}>
        <span className={styles.rankBadge} aria-hidden>
          {rank}
        </span>
        <VideoCard video={toVideoCardData(item)} />
      </div>
      {weeklyViewsText != null ? (
        <p className={styles.weeklyViews}>{weeklyViewsText}</p>
      ) : null}
    </article>
  );
}
