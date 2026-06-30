import * as React from "react";
import Link from "next/link";
import styles from "./CreatorCard.module.css";
import { UserAvatar } from "@/components/user/UserAvatar";
import { cn } from "@/lib/utils/cn";

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
        <UserAvatar
          iconUrl={data.icon_url}
          label={data.x_name}
          useIconFallback
          className={styles.avatar}
          fallbackClassName={styles.iconFallback}
        />
      </div>
      <span className="fn-ccard-name">{data.x_name}</span>
      <span className="fn-ccard-handle">{hint}</span>
    </Link>
  );
}
