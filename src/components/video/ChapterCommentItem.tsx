"use client";

import * as React from "react";
import Image from "next/image";
import styles from "./ChapterCommentItem.module.css";
import { Icon } from "@/components/ui/Icon";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * 動画詳細ページ内で「チャプター = 1 件のコメント」を統一表示するコンポーネント。
 *
 * 用途:
 *   1) ChapterTabs (チャプターコメント一覧)
 *   2) MemberSection の "担当チャプター" 表示 (video_member_id でグループ化したもの)
 *
 * 既存仕様維持:
 *   - 可視性バッジ (private = 非公開)
 *   - 範囲外 (動画 duration 超え) は色を落とす
 *   - クリックで onSeek(chapter_time) を発火
 *   - marker_kind には依存しない (CLAUDE.md 方針)
 */
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
  /** 投稿者の表示有無。MemberSection ではメンバー側で表示しているので false。 */
  showAuthor?: boolean;
  /** クリックで動画をシークするコールバック。範囲外のときは発火しない。 */
  onSeek?: (time: number) => void;
  className?: string;
}

export function ChapterCommentItem({
  chapter,
  duration,
  showAuthor = false,
  onSeek,
  className,
}: ChapterCommentItemProps): React.ReactElement {
  const outOfRange = duration ? chapter.chapter_time > duration : false;
  const handleClick = React.useCallback(() => {
    if (outOfRange) return;
    onSeek?.(chapter.chapter_time);
  }, [outOfRange, onSeek, chapter.chapter_time]);

  return (
    <div
      className={cn(
        styles.item,
        outOfRange && styles.outOfRange,
        onSeek && !outOfRange && styles.clickable,
        className,
      )}
      role={onSeek ? "button" : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onClick={onSeek ? handleClick : undefined}
      onKeyDown={
        onSeek
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      <span className={styles.timeBadge}>
        {formatDuration(chapter.chapter_time)}
      </span>
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <Icon
            name="chapter"
            size={11}
            className={styles.icon}
            aria-hidden
          />
          <span className={styles.title}>{chapter.chapter_label}</span>
          {chapter.visibility === "private" ? (
            <span className="fn-badge fn-badge-neutral">非公開</span>
          ) : null}
          {outOfRange ? (
            <span className="fn-badge fn-badge-neutral">範囲外</span>
          ) : null}
        </div>
        {showAuthor && chapter.author_name ? (
          <div className={styles.authorRow}>
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
          </div>
        ) : null}
        {chapter.note ? (
          <p className={styles.note}>{chapter.note}</p>
        ) : null}
      </div>
    </div>
  );
}
