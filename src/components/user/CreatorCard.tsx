import * as React from "react";
import Link from "next/link";
import styles from "./CreatorCard.module.css";
import { Icon } from "@/components/ui/Icon";

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
  return (
    <Link href={`/user/${data.id}`} className={styles.card} prefetch={false}>
      <div className={styles.iconWrap}>
        {data.icon_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={data.icon_url}
            alt=""
            loading="lazy"
            className={styles.icon}
          />
        ) : (
          <span className={styles.iconFallback}>
            <Icon name="user" size={28} aria-hidden />
          </span>
        )}
      </div>
      <span className={styles.name}>{data.x_name}</span>
      <span className={styles.hint}>
        {data.hint
          ? data.hint
          : data.video_count !== undefined
            ? `@${data.id} · ${data.video_count} 作品`
            : `@${data.id}`}
      </span>
    </Link>
  );
}
