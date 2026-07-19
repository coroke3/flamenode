"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import styles from "./ChapterTabs.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import {
  deleteChapter,
  getChapterDeleteCapabilities,
} from "@/lib/actions/chapter";
import {
  ChapterCommentItem,
  type ChapterCommentItemEntry,
} from "./ChapterCommentItem";
import { seekToTime } from "./playerBridge";
import { formatDuration } from "@/lib/utils/format";

export interface ChapterEntry extends ChapterCommentItemEntry {
  marker_kind: "comment" | "chapter" | "review" | "system";
}

interface ChapterTabsProps {
  chapters: ChapterEntry[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}

export function ChapterTabs({
  chapters,
  duration,
  onSeek = seekToTime,
}: ChapterTabsProps): React.ReactElement {
  const router = useRouter();
  const [deletableIds, setDeletableIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [pendingDelete, setPendingDelete] =
    React.useState<ChapterEntry | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [, startCapabilityTransition] = React.useTransition();
  const [deleting, startDeleteTransition] = React.useTransition();
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  const chapterIdsKey = React.useMemo(
    () => chapters.map((chapter) => chapter.id).join("\u001f"),
    [chapters],
  );

  React.useEffect(() => {
    let cancelled = false;
    const ids = chapterIdsKey ? chapterIdsKey.split("\u001f") : [];
    if (ids.length === 0) {
      setDeletableIds(new Set());
      return;
    }

    startCapabilityTransition(async () => {
      const result = await getChapterDeleteCapabilities(ids);
      if (!cancelled) {
        setDeletableIds(new Set(result.ok ? result.deletableIds : []));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chapterIdsKey]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!pendingDelete) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        event.preventDefault();
        setPendingDelete(null);
        setDeleteError(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [pendingDelete, deleting]);

  const visibleChapters = chapters.filter((chapter) => !hiddenIds.has(chapter.id));

  const requestDelete = React.useCallback((chapter: ChapterCommentItemEntry) => {
    const matched = chapters.find((entry) => entry.id === chapter.id);
    if (!matched) return;
    setDeleteError(null);
    setPendingDelete(matched);
  }, [chapters]);

  const closeDialog = React.useCallback(() => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleting]);

  const confirmDelete = React.useCallback(() => {
    if (!pendingDelete) return;

    const target = pendingDelete;
    const formData = new FormData();
    formData.set("chapter_id", target.id);
    setDeleteError(null);

    startDeleteTransition(async () => {
      const result = await deleteChapter(formData);
      if (!result.ok) {
        setDeleteError(result.message ?? "削除に失敗しました。");
        return;
      }

      setHiddenIds((current) => {
        const next = new Set(current);
        next.add(target.id);
        return next;
      });
      setDeletableIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setPendingDelete(null);
      setToast("チャプターコメントを削除しました");
      router.refresh();
    });
  }, [pendingDelete, router]);

  return (
    <div className={styles.root}>
      <div className={styles.tabs}>
        <TabButton
          icon="chapter"
          label="チャプターコメント"
          count={visibleChapters.length}
        />
      </div>
      <div className={styles.list}>
        {visibleChapters.length === 0 ? (
          <div className={styles.listEmpty}>
            チャプターコメントはまだありません。
          </div>
        ) : (
          visibleChapters.map((chapter) => (
            <ChapterCommentItem
              key={chapter.id}
              chapter={chapter}
              duration={duration}
              showAuthor
              onSeek={onSeek}
              canDelete={deletableIds.has(chapter.id)}
              onDeleteRequest={requestDelete}
            />
          ))
        )}
      </div>

      {pendingDelete ? (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="chapter-delete-dialog-title"
            aria-describedby="chapter-delete-dialog-description"
          >
            <div className={styles.dialogIcon} aria-hidden>
              <Icon name="trash" size={18} />
            </div>
            <div className={styles.dialogBody}>
              <h3 id="chapter-delete-dialog-title" className={styles.dialogTitle}>
                チャプターコメントを削除しますか？
              </h3>
              <p
                id="chapter-delete-dialog-description"
                className={styles.dialogDescription}
              >
                <strong>{formatDuration(pendingDelete.chapter_time)}</strong>
                <span>「{pendingDelete.chapter_label}」</span>
              </p>
              <p className={styles.dialogWarning}>この操作は取り消せません。</p>
              {deleteError ? (
                <p className={styles.dialogError} role="alert">
                  <Icon name="warning" size={12} aria-hidden />
                  {deleteError}
                </p>
              ) : null}
            </div>
            <div className={styles.dialogActions}>
              <button
                ref={cancelButtonRef}
                type="button"
                className="fn-btn fn-btn-ghost"
                onClick={closeDialog}
                disabled={deleting}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={styles.confirmDeleteButton}
                onClick={confirmDelete}
                disabled={deleting}
              >
                <Icon name="trash" size={14} aria-hidden />
                {deleting ? "削除中…" : "削除する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          <Icon name="check" size={14} aria-hidden />
          {toast}
        </div>
      ) : null}
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
