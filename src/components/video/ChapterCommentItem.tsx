"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import styles from "./ChapterCommentItem.module.css";
import { Icon } from "@/components/ui/Icon";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { deleteChapter } from "@/lib/actions/chapter";

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
  className?: string;
}

export function ChapterCommentItem({
  chapter,
  duration,
  showAuthor = false,
  onSeek,
  className,
}: ChapterCommentItemProps): React.ReactElement {
  const router = useRouter();
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleting, startDeleteTransition] = React.useTransition();
  const outOfRange = duration ? chapter.chapter_time > duration : false;

  const handleClick = React.useCallback(() => {
    if (outOfRange) return;
    onSeek?.(chapter.chapter_time);
  }, [outOfRange, onSeek, chapter.chapter_time]);

  const handleDelete = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDeleteError(null);

      if (!window.confirm(`「${chapter.chapter_label}」を削除しますか？`)) {
        return;
      }

      const formData = new FormData();
      formData.set("chapter_id", chapter.id);
      startDeleteTransition(async () => {
        const result = await deleteChapter(formData);
        if (!result.ok) {
          setDeleteError(result.message ?? "削除に失敗しました。");
          return;
        }
        router.refresh();
      });
    },
    [chapter.chapter_label, chapter.id, router],
  );

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
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
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
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={deleting}
            title="投稿者本人、作品管理者、管理者のみ削除できます"
            onClick={handleDelete}
            onKeyDown={(event) => event.stopPropagation()}
            style={{ marginLeft: "auto" }}
          >
            {deleting ? "削除中…" : "削除"}
          </button>
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

        {chapter.note ? <p className={styles.note}>{chapter.note}</p> : null}
        {deleteError ? (
          <p
            role="alert"
            style={{
              margin: "6px 0 0",
              fontSize: 11,
              color: "var(--accent-danger)",
            }}
          >
            {deleteError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
