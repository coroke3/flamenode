"use client";

import * as React from "react";
import styles from "./ChapterCommentItem.module.css";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * メンバーチャプター 1 件の表示。
 *
 * ChapterCommentItem と見た目は近いが、通常チャプターコメントとは別データ・別用途。
 *   - メンバーチャプターは visibility や投稿者表示を持たない (内部は video_members.chapters_json)
 *   - 公開ページの MemberSection 内でメンバー別グループの中に並ぶ
 *   - クリックで onSeek(chapter_time) を発火し、動画をシークする
 *
 * 既存 ChapterCommentItem を継承的に使い回さず、UI/型を分けることで「投稿者」「可視性」
 * といった意味の混在を避ける (CLAUDE.md 方針: marker_kind 等の意味混在を避ける)。
 */
export interface MemberChapterItemEntry {
  id: string;
  chapter_time: number;
  chapter_label: string;
  note?: string | null;
}

interface MemberChapterItemProps {
  chapter: MemberChapterItemEntry;
  /** 動画の長さ（秒）。超過時はシーク操作だけを無効化する。 */
  duration?: number | null;
  /** クリックで動画をシークするコールバック。時間超過時は発火しない。 */
  onSeek?: (time: number) => void;
  className?: string;
}

export function MemberChapterItem({
  chapter,
  duration,
  onSeek,
  className,
}: MemberChapterItemProps): React.ReactElement {
  const hasDuration =
    duration != null &&
    Number.isFinite(duration);
  const outOfRange =
    hasDuration &&
    chapter.chapter_time > duration;
  const interactive =
    Boolean(onSeek) &&
    !outOfRange;

  const handleClick = React.useCallback(() => {
    if (outOfRange) return;
    onSeek?.(chapter.chapter_time);
  }, [outOfRange, onSeek, chapter.chapter_time]);

  return (
    <div
      className={cn(
        styles.item,
        outOfRange && styles.outOfRange,
        interactive && styles.clickable,
        className,
      )}
      role={onSeek ? "button" : undefined}
      tabIndex={onSeek ? (interactive ? 0 : -1) : undefined}
      aria-disabled={onSeek ? outOfRange : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={
        interactive
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
          <span className={styles.title}>{chapter.chapter_label}</span>
        </div>
        {chapter.note ? <p className={styles.note}>{chapter.note}</p> : null}
      </div>
    </div>
  );
}
