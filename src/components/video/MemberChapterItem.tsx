"use client";

import * as React from "react";
import styles from "./ChapterCommentItem.module.css";
import { Icon } from "@/components/ui/Icon";
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
  /** 動画の長さ (秒)。chapter_time がこれを超えていれば「範囲外」表示。 */
  duration?: number | null;
  /** クリックで動画をシークするコールバック。範囲外のときは発火しない。 */
  onSeek?: (time: number) => void;
  className?: string;
}

export function MemberChapterItem({
  chapter,
  duration,
  onSeek,
  className,
}: MemberChapterItemProps): React.ReactElement {
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
          {outOfRange ? (
            <span className="fn-badge fn-badge-neutral">範囲外</span>
          ) : null}
        </div>
        {chapter.note ? <p className={styles.note}>{chapter.note}</p> : null}
      </div>
    </div>
  );
}
