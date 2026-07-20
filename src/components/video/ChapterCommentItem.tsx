"use client";

import * as React from "react";
import Image from "next/image";
import styles from "./ChapterCommentItem.module.css";
import { Icon } from "@/components/ui/Icon";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/** 動画詳細ページ内で通常チャプターコメントを表示する。 */
export interface ChapterCommentItemEntry {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "public" | "private";
  note?: string | null;
  author_name?: string | null;
  author_icon?: string | null;
}

interface ChapterCommentItemProps {
  chapter: ChapterCommentItemEntry;
  /** 動画の長さ (秒)。chapter_time がこれを超えていれば「範囲外」表示。 */
  duration?: number | null;
  /** 投稿者の表示有無。 */
  showAuthor?: boolean;
  /** クリックで動画をシークするコールバック。範囲外のときは発火しない。 */
  onSeek?: (time: number) => void;
  /** 投稿者本人・作品管理者・管理者の場合のみ true。 */
  canDelete?: boolean;
  onDeleteRequest?: (chapter: ChapterCommentItemEntry) => void;
  className?: string;
}

export function ChapterCommentItem({
  chapter,
  duration,
  showAuthor = false,
  onSeek,
  canDelete = false,
  onDeleteRequest,
  className,
}: ChapterCommentItemProps): React.ReactElement {
  const outOfRange = duration != null && chapter.chapter_time > duration;
  const canSeek = Boolean(onSeek && !outOfRange);
  const formattedTime = formatDuration(chapter.chapter_time);

  const content = (
    <>
      <span className={styles.timeBadge}>{formattedTime}</span>
      <span className={styles.body}>
        <span className={styles.titleRow}>
          <Icon
            name="chapter"
            size={11}
            className={styles.icon}
            aria-hidden
          />
          <span className={styles.title} title={chapter.chapter_label}>
            {chapter.chapter_label}
          </span>
          {chapter.visibility === "private" ? (
            <span className="fn-badge fn-badge-neutral">非公開</span>
          ) : null}
          {outOfRange ? (
            <span className="fn-badge fn-badge-neutral">範囲外</span>
          ) : null}
        </span>

        {showAuthor && chapter.author_name ? (
          <span className={styles.authorRow}>
            {chapter.author_icon ? (
              <Image
                src={chapter.author_icon}
                alt=""
                width={18}
                height={18}
                className={styles.authorIcon}
                unoptimized
              />
            ) : (
              <span className={styles.authorIconFallback} aria-hidden>
                <Icon name="user" size={10} />
              </span>
            )}
            <span className={styles.authorName}>{chapter.author_name}</span>
          </span>
        ) : null}

        {chapter.note ? <span className={styles.note}>{chapter.note}</span> : null}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        styles.item,
        outOfRange && styles.outOfRange,
        className,
      )}
    >
      {canSeek ? (
        <button
          type="button"
          className={styles.seekTarget}
          onClick={() => onSeek?.(chapter.chapter_time)}
          aria-label={`${formattedTime}へ移動: ${chapter.chapter_label}`}
        >
          {content}
        </button>
      ) : (
        <div className={styles.staticTarget}>{content}</div>
      )}

      {canDelete && onDeleteRequest ? (
        <button
          type="button"
          className={styles.deleteButton}
          onClick={() => onDeleteRequest(chapter)}
          aria-label={`チャプターコメント「${chapter.chapter_label}」を削除`}
          title="削除"
        >
          <Icon name="trash" size={15} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
