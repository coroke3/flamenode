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
  const headingId = React.useId();
  const dialogTitleId = React.useId();
  const dialogDescriptionId = React.useId();
  const dialogWarningId = React.useId();
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
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const deletingRef = React.useRef(false);
  const capabilityRequestRef = React.useRef(0);

  const chapterIdsKey = React.useMemo(
    () => chapters.map((chapter) => chapter.id).join("\u001f"),
    [chapters],
  );

  React.useEffect(() => {
    const requestId = capabilityRequestRef.current + 1;
    capabilityRequestRef.current = requestId;
    const ids = chapterIdsKey ? chapterIdsKey.split("\u001f") : [];

    if (ids.length === 0) {
      setDeletableIds(new Set());
      return;
    }

    startCapabilityTransition(async () => {
      try {
        const result = await getChapterDeleteCapabilities(ids);
        if (capabilityRequestRef.current !== requestId) return;
        setDeletableIds(new Set(result.ok ? result.deletableIds : []));
      } catch (error) {
        if (capabilityRequestRef.current !== requestId) return;
        setDeletableIds(new Set());
        console.error("chapter delete capability request failed", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    });
  }, [chapterIdsKey]);

  React.useEffect(() => {
    setHiddenIds((current) => {
      if (current.size === 0) return current;
      const sourceIds = new Set(chapters.map((chapter) => chapter.id));
      const next = new Set(
        Array.from(current).filter((chapterId) => sourceIds.has(chapterId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [chapters]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!pendingDelete) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() =>
      cancelButtonRef.current?.focus(),
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
      window.requestAnimationFrame(() => {
        const previous = previousFocusRef.current;
        if (previous?.isConnected) {
          previous.focus();
        } else {
          listRef.current?.focus();
        }
      });
    };
  }, [pendingDelete]);

  const visibleChapters = React.useMemo(
    () => chapters.filter((chapter) => !hiddenIds.has(chapter.id)),
    [chapters, hiddenIds],
  );

  const requestDelete = React.useCallback(
    (chapter: ChapterCommentItemEntry) => {
      const matched = chapters.find((entry) => entry.id === chapter.id);
      if (!matched || hiddenIds.has(matched.id) || deletingRef.current) return;
      setDeleteError(null);
      setPendingDelete(matched);
    },
    [chapters, hiddenIds],
  );

  const closeDialog = React.useCallback(() => {
    if (deletingRef.current) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, []);

  const confirmDelete = React.useCallback(() => {
    if (!pendingDelete || deletingRef.current) return;

    const target = pendingDelete;
    const formData = new FormData();
    formData.set("chapter_id", target.id);
    setDeleteError(null);
    deletingRef.current = true;

    startDeleteTransition(async () => {
      try {
        const result = await deleteChapter(formData);
        if (!result.ok) {
          setDeleteError(result.message ?? "削除に失敗しました。");
          return;
        }

        setHiddenIds((current) => new Set(current).add(target.id));
        setDeletableIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
        setPendingDelete(null);
        setToast(result.message ?? "チャプターコメントを削除しました");
        router.refresh();
      } catch (error) {
        setDeleteError(
          "通信に失敗しました。接続を確認して、もう一度お試しください。",
        );
        console.error("chapter comment delete request failed", {
          chapterId: target.id,
          errorName: error instanceof Error ? error.name : "unknown",
        });
      } finally {
        deletingRef.current = false;
      }
    });
  }, [pendingDelete, router]);

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.tabs}>
        <TabButton
          headingId={headingId}
          icon="chapter"
          label="チャプターコメント"
          count={visibleChapters.length}
        />
      </div>
      <div
        ref={listRef}
        className={styles.list}
        aria-label="チャプターコメント一覧"
        tabIndex={-1}
      >
        {visibleChapters.length === 0 ? (
          <div className={styles.listEmpty}>
            <span className={styles.listEmptyIcon} aria-hidden>
              <Icon name="chapter" size={16} />
            </span>
            <strong>チャプターコメントはまだありません</strong>
            <span>動画内の時刻に、見どころや補足を残せます。</span>
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
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          aria-labelledby={dialogTitleId}
          aria-describedby={`${dialogDescriptionId} ${dialogWarningId}`}
          aria-busy={deleting}
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
        >
          <div className={styles.dialogIcon} aria-hidden>
            <Icon name="trash" size={18} />
          </div>
          <div className={styles.dialogBody}>
            <h3 id={dialogTitleId} className={styles.dialogTitle}>
              チャプターコメントを削除しますか？
            </h3>
            <p id={dialogDescriptionId} className={styles.dialogDescription}>
              <strong>{formatDuration(pendingDelete.chapter_time)}</strong>
              <span>「{pendingDelete.chapter_label}」</span>
            </p>
            <p id={dialogWarningId} className={styles.dialogWarning}>
              この操作は取り消せません。
            </p>
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
        </dialog>
      ) : null}

      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          <Icon name="check" size={14} aria-hidden />
          {toast}
        </div>
      ) : null}
    </section>
  );
}

function TabButton({
  headingId,
  label,
  icon,
  count,
}: {
  headingId: string;
  label: string;
  icon: "chapter";
  count: number;
}): React.ReactElement {
  return (
    <div
      id={headingId}
      className={cn(styles.tab, styles.tabActive)}
      role="heading"
      aria-level={2}
    >
      <Icon name={icon} size={13} aria-hidden />
      <span>{label}</span>
      <span className={styles.tabCount} aria-label={`${count}件`}>
        {count}
      </span>
    </div>
  );
}
