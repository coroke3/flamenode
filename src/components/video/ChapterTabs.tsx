"use client";

import * as React from "react";
import styles from "./ChapterTabs.module.css";
import { Icon } from "@/components/ui/Icon";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface ChapterEntry {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "public" | "private";
  marker_kind: "comment" | "chapter" | "review" | "system";
  note?: string | null;
  author_name?: string | null;
  author_icon?: string | null;
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
      <ul className={styles.list}>
        {chapters.length === 0 ? (
          <li className={styles.listEmpty}>
            チャプターコメントはまだありません。
          </li>
        ) : (
          chapters.map((c) => {
            const outOfRange = duration ? c.chapter_time > duration : false;
            return (
              <li
                key={c.id}
                className={cn(
                  styles.itemChapter,
                  outOfRange && styles.outOfRange,
                )}
                onClick={() => !outOfRange && onSeek?.(c.chapter_time)}
              >
                <span className={styles.timeBadge}>
                  {formatDuration(c.chapter_time)}
                </span>
                <div className={styles.chapterBody}>
                  <div className={styles.chapterRow}>
                    <Icon
                      name="chapter"
                      size={11}
                      className={styles.chapterIcon}
                      aria-hidden
                    />
                    <span className={styles.chapterTitle}>
                      {c.chapter_label}
                    </span>
                    {c.visibility === "private" ? (
                      <span className="fn-badge fn-badge-neutral">
                        非公開
                      </span>
                    ) : null}
                    {outOfRange ? (
                      <span className="fn-badge fn-badge-neutral">
                        範囲外
                      </span>
                    ) : null}
                  </div>
                  {c.note ? (
                    <p className={styles.chapterNote}>{c.note}</p>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>
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
