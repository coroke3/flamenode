import * as React from "react";
import Link from "next/link";
import styles from "./VideoCard.module.css";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

export interface VideoCardData {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url?: string | null;
  creator_x_user_id?: string | null;
  primary_event_id?: string | null;
  scheduled_time?: number | null;
  status?: string | null;
}

interface VideoCardProps {
  video: VideoCardData;
  size?: "default" | "compact" | "list";
  href?: string;
}

/**
 * 公開ページの作品カード。サムネ + 2行タイトル + 作者行に絞る。
 * カード背景は透明、サムネ角丸 8px、ホバーでサムネを 1.04 拡大する。
 */
export function VideoCard({
  video,
  size = "default",
  href,
}: VideoCardProps): React.ReactElement {
  const link = href ?? `/${video.youtube_video_id ?? video.id}`;
  const thumb = youtubeThumbUrl(video.youtube_video_id, "hqdefault");

  if (size === "list") {
    return (
      <Link href={link} className={styles.list} prefetch={false}>
        <div className={styles.listThumb}>
          {thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumb} alt="" loading="lazy" />
          ) : (
            <div className={styles.thumbFallback}>
              <Icon name="youtube" size={24} aria-hidden />
            </div>
          )}
        </div>
        <div className={styles.listBody}>
          <h3 className={styles.listTitle}>{video.title}</h3>
          <p className={styles.listAuthor}>{video.display_name}</p>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={link}
      className={cn(styles.card, size === "compact" && styles.compact)}
      prefetch={false}
    >
      <div className={styles.thumbWrap}>
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" loading="lazy" className={styles.thumb} />
        ) : (
          <div className={styles.thumbFallback}>
            <Icon name="youtube" size={28} aria-hidden />
          </div>
        )}
        {video.status === "limited" ? (
          <span className={cn("fn-badge", "fn-badge-soft", styles.statusBadge)}>
            限定公開
          </span>
        ) : video.status === "hidden" ? (
          <span
            className={cn("fn-badge", "fn-badge-warning", styles.statusBadge)}
          >
            調整中
          </span>
        ) : null}
      </div>
      <h3 className={styles.title}>{video.title}</h3>
      <div className={styles.author}>
        {video.icon_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={video.icon_url}
            alt=""
            loading="lazy"
            className={styles.authorIcon}
          />
        ) : (
          <span className={styles.authorIconFallback}>
            <Icon name="user" size={10} aria-hidden />
          </span>
        )}
        <span className={styles.authorName}>{video.display_name}</span>
      </div>
    </Link>
  );
}
