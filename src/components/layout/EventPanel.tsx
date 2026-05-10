import * as React from "react";
import Link from "next/link";
import styles from "./EventPanel.module.css";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface EventPanelProps {
  event: {
    id: string;
    title: string;
    icon_url?: string | null;
    accent_color?: string | null;
    start_time?: number | null;
    end_time?: number | null;
    is_active?: number | null;
    is_archived?: number | null;
    explanation?: string | null;
  };
  videos: VideoCardData[];
}

/**
 * トップページのイベントセクションで使う、低い角丸パネルにイベント名 + 内部小型作品グリッド。
 * イベントアクセントカラーがあればホバー線・参加 CTA・タイトル下線にその色を使う。
 */
export function EventPanel({
  event,
  videos,
}: EventPanelProps): React.ReactElement {
  const accent = event.accent_color || undefined;
  const cssVars = accent
    ? ({ ["--event-accent" as never]: accent } as React.CSSProperties)
    : undefined;

  return (
    <section className={styles.panel} style={cssVars}>
      <header className={styles.head}>
        <Link href={`/event/${event.id}`} className={styles.headLink}>
          <div className={styles.iconWrap}>
            {event.icon_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={event.icon_url} alt="" />
            ) : (
              <Icon name="calendar" size={18} aria-hidden />
            )}
          </div>
          <div className={styles.titleArea}>
            <h3 className={cn(styles.title, accent && styles.titleAccent)}>
              {event.title}
            </h3>
            <p className={styles.meta}>
              <span>
                {formatUnix(event.start_time, { dateOnly: true })}
                {event.end_time
                  ? ` 〜 ${formatUnix(event.end_time, { dateOnly: true })}`
                  : ""}
              </span>
              {event.is_active === 1 ? (
                <span className={styles.activeBadge}>開催中</span>
              ) : event.is_archived === 1 ? (
                <span className={styles.archivedBadge}>アーカイブ</span>
              ) : null}
            </p>
          </div>
        </Link>
        <Link href={`/event/${event.id}`} className={styles.detailsLink}>
          詳細 →
        </Link>
      </header>

      {videos.length === 0 ? (
        <p className={styles.empty}>作品はまだ登録されていません。</p>
      ) : (
        <div className={styles.grid}>
          {videos.slice(0, 8).map((v) => (
            <VideoCard key={v.id} video={v} size="compact" />
          ))}
        </div>
      )}
    </section>
  );
}
