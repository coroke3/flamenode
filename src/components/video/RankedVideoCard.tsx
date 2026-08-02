import * as React from "react";
import { VideoCard, type VideoCardData } from "./VideoCard";
import styles from "./RankedVideoCard.module.css";
import type { TrendingItem } from "@/lib/publicData/staticTrendingCore";
import { cn } from "@/lib/utils/cn";

export interface RankedVideoCardProps {
  item: TrendingItem;
  rank: number;
  className?: string;
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
}: RankedVideoCardProps): React.ReactElement {
  return (
    <article
      className={cn(styles.root, className)}
      aria-label={`${rank}位 ${item.title}`}
    >
      <div className={styles.cardWrap}>
        <span className={styles.rankBadge} aria-hidden>
          {rank}
        </span>
        <VideoCard video={toVideoCardData(item)} />
      </div>
    </article>
  );
}
