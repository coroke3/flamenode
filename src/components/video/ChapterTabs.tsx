"use client";

import * as React from "react";
import styles from "./ChapterTabs.module.css";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatDuration, formatRelative } from "@/lib/utils/format";
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

export interface CommentEntry {
  id: string;
  body: string;
  created_at: number;
  chapter_time?: number | null;
  chapter_label?: string | null;
  author_name?: string | null;
  author_icon?: string | null;
}

interface ChapterTabsProps {
  chapters: ChapterEntry[];
  comments: CommentEntry[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}

type Tab = "chapters" | "comments";

export function ChapterTabs({
  chapters,
  comments,
  duration,
  onSeek,
}: ChapterTabsProps): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>("chapters");

  return (
    <div className={styles.root}>
      <div role="tablist" className={styles.tabs}>
        <TabButton
          active={tab === "chapters"}
          onClick={() => setTab("chapters")}
          icon="chapter"
          label="チャプター"
          count={chapters.length}
        />
        <TabButton
          active={tab === "comments"}
          onClick={() => setTab("comments")}
          icon="comment"
          label="コメント"
          count={comments.length}
        />
      </div>
      {tab === "chapters" ? (
        <ul className={styles.list}>
          {chapters.length === 0 ? (
            <li className={styles.listEmpty}>
              チャプターはまだありません。
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
                      {c.marker_kind === "chapter" ? (
                        <Icon
                          name="chapter"
                          size={11}
                          className={styles.chapterIcon}
                          aria-hidden
                        />
                      ) : null}
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
      ) : (
        <ul className={styles.list}>
          {comments.length === 0 ? (
            <li className={styles.listEmpty}>
              コメントはまだありません。
            </li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className={styles.itemComment}>
                {c.author_icon ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={c.author_icon}
                    alt=""
                    className={styles.commentIcon}
                  />
                ) : (
                  <span className={styles.commentIconFallback}>
                    <Icon name="user" size={12} aria-hidden />
                  </span>
                )}
                <div className={styles.commentBody}>
                  <div className={styles.commentMeta}>
                    <span className={styles.commentAuthor}>
                      {c.author_name ?? "anonymous"}
                    </span>
                    {c.chapter_time != null ? (
                      <button
                        type="button"
                        className={styles.commentTime}
                        onClick={() => onSeek?.(c.chapter_time!)}
                      >
                        {formatDuration(c.chapter_time)}
                      </button>
                    ) : null}
                    <span>{formatRelative(c.created_at)}</span>
                  </div>
                  <p className={styles.commentText}>{c.body}</p>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: IconName;
  count: number;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(styles.tab, active && styles.tabActive)}
    >
      <Icon name={icon} size={13} aria-hidden />
      {label}
      <span className={styles.tabCount}>({count})</span>
    </button>
  );
}
