import * as React from "react";
import Link from "next/link";
import styles from "./VideoCard.module.css";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";

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
  part?: string | null;
}

interface VideoCardProps {
  video: VideoCardData;
  size?: "default" | "compact" | "list";
  href?: string;
  /** Optional page-specific metadata (for example an event's publish time). */
  secondaryMeta?: React.ReactNode;
}

export function VideoCard({
  video,
  size = "default",
  href,
  secondaryMeta,
}: VideoCardProps): React.ReactElement {
  const link = href ?? `/${video.youtube_video_id?.trim() || video.id}`;
  const thumb = youtubeThumbUrl(video.youtube_video_id, "mqdefault");
  const creatorIcon = cachedGoogleImageUrl(video.icon_url);

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
      className={cn("fn-vcard", styles.card, size === "compact" && styles.compact)}
      prefetch={false}
    >
      <div className={cn("fn-thumb", styles.thumbWrap)}>
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" loading="lazy" className={styles.thumb} />
        ) : (
          <div className={styles.thumbFallback}>
            <Icon name="youtube" size={28} aria-hidden />
          </div>
        )}
        <span className="fn-thumb-grid" aria-hidden />
        {video.status === "private" ? (
          <span className={cn("fn-badge", "fn-badge-soft", styles.statusBadge)}>
            非公開
          </span>
        ) : video.status === "voided" ? (
          <span className={cn("fn-badge", "fn-badge-neutral", styles.statusBadge)}>
            無効
          </span>
        ) : null}
        {video.part ? (
          <span className={cn("fn-badge", "fn-badge-soft", styles.partBadge)}>
            {video.part}
          </span>
        ) : null}
      </div>
      <div className="fn-vcard-body">
        <h3 className="fn-vcard-title">{video.title}</h3>
        <div className="fn-vcard-meta">
          <div className="fn-vcard-creator">
            <span className="fn-vcard-avatar">
              {creatorIcon ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={creatorIcon} alt="" loading="lazy" />
              ) : (
                <Icon name="user" size={10} aria-hidden />
              )}
            </span>
            <span>{video.display_name}</span>
          </div>
          {secondaryMeta ? (
            <div className={styles.secondaryMeta}>{secondaryMeta}</div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
