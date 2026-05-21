"use client";

import * as React from "react";
import styles from "./ChapterTabs.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { ChapterCommentItem } from "./ChapterCommentItem";

export interface ChapterEntry {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "public" | "private";
  marker_kind: "comment" | "chapter" | "review" | "system";
  note?: string | null;
  author_name?: string | null;
  author_icon?: string | null;
  video_member_id?: string | null;
}

interface ChapterTabsProps {
  chapters: ChapterEntry[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}

export function ChapterTabs({
  chapters,
  duration,
  onSeek,
}: ChapterTabsProps): React.ReactElement {
  return (
    <div className={styles.root}>
      <div className={styles.tabs}>
        <TabButton
          icon="chapter"
          label="チャプターコメント"
          count={chapters.length}
        />
      </div>
      <div className={styles.list}>
        {chapters.length === 0 ? (
          <div className={styles.listEmpty}>
            チャプターコメントはまだありません。
          </div>
        ) : (
          chapters.map((c, index) => (
            <ChapterCommentItem
              key={`${c.id}-chapter-${index}`}
              chapter={c}
              duration={duration}
              showAuthor
              onSeek={onSeek}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  icon,
  count,
}: {
  label: string;
  icon: "chapter";
  count: number;
}): React.ReactElement {
  return (
    <div className={cn(styles.tab, styles.tabActive)}>
      <Icon name={icon} size={13} aria-hidden />
      {label}
      <span className={styles.tabCount}>({count})</span>
    </div>
  );
}
