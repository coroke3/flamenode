import * as React from "react";
import Link from "next/link";
import styles from "./CreatorCard.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";

interface CreatorCardData {
  id: string;
  x_name: string;
  icon_url?: string | null;
  video_count?: number;
  hint?: string;
}

export function CreatorCard({
  data,
}: {
  data: CreatorCardData;
}): React.ReactElement {
  const iconUrl = cachedGoogleImageUrl(data.icon_url);
  const hint =
    data.hint ??
    (data.video_count !== undefined
      ? `@${data.id} · ${data.video_count}作品`
      : `@${data.id}`);

  return (
    <Link
      href={`/user/${data.id}`}
      className={cn("fn-ccard", styles.card)}
      prefetch={false}
    >
      <div className="fn-ccard-avatar">
        {iconUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={iconUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.iconFallback}>
            <Icon name="user" size={28} aria-hidden />
          </span>
        )}
      </div>
      <span className="fn-ccard-name">{data.x_name}</span>
      <span className="fn-ccard-handle">{hint}</span>
    </Link>
  );
}
