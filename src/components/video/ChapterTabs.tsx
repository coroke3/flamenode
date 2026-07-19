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

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
  const dialogRef = React.useRef<HTMLElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const deletingRef = React.useRef(false);
  const capabilityRequestRef = React.useRef(0);

  const chapterIdsKey = React.useMemo(
    () => chapters.map((chapter) => chapter.id).join("\u001f"),
    [chapters],
  );

  React.useEffect(() => {
    deletingRef.current = deleting;
  }, [deleting]);

  React.useEffect(() => {
    const requestId = capabilityRequestRef.current + 1;
    capabilityRequestRef.current = requestId;
    const ids = chapterIdsKey ? chapterIdsKey.split("\u001f") : [];

    if (ids.length === 0) {
      setDeletableIds(new Set());
      return;
    }

    startCapabilityTransition(async () => {
      const result = await getChapterDeleteCapabilities(ids);
      if (capabilityRequestRef.current !== requestId) return;
      setDeletableIds(new Set(result.ok ? result.deletableIds : []));
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

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deletingRef.current) {
        event.preventDefault();
        setPendingDelete(null);
        setDeleteError(null);
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [pendingDelete]);

  const visibleChapters = React.useMemo(
    () => chapters.filter((chapter) => !hiddenIds.has(chapter.id)),
    [chapters, hiddenIds],
  );

  const requestDelete = React.useCallback(
    (chapter: ChapterCommentItemEntry) => {
      const matched = chapters.find((entry) => entry.id === chapter.id);
      if (!matched || hiddenIds.has(matched.id)) return;
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
    <section className={styles.root} aria-labelledby="chapter-comments-heading">
      <div className={styles.tabs}>
        <TabButton
          icon="chapter"
          label="チャプターコメント"
          count={visibleChapters.length}
        />
      </div>
      <div className={styles.list} aria-live="polite">
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
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            ref={dialogRef}
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="chapter-delete-dialog-title"
            aria-describedby="chapter-delete-dialog-description"
            aria-busy={deleting}
            tabIndex={-1}
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
    </section>
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
    <div
      id="chapter-comments-heading"
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
