"use client";

import * as React from "react";
import Link from "next/link";
import { ChapterTabs, type ChapterEntry } from "./ChapterTabs";
import { ChapterComposer } from "./ChapterComposer";
import { usePlayerTime } from "./usePlayerTime";
import { Icon } from "@/components/ui/Icon";
import styles from "./ChapterCommentPanel.module.css";

interface ChapterCommentPanelProps {
  videoId: string;
  chapters: ChapterEntry[];
  isLoggedIn: boolean;
  canPost: boolean;
  loginHref: string;
  settingsHref: string;
}

function scrollToSubmittedChapter(chapterTime: number, attemptsLeft: number): void {
  const root = document.querySelector<HTMLElement>(
    `[data-chapter-time="${chapterTime}"]`,
  );

  if (root) {
    root.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
    return;
  }

  if (attemptsLeft <= 0) return;

  window.setTimeout(() => {
    scrollToSubmittedChapter(chapterTime, attemptsLeft - 1);
  }, 200);
}

export function ChapterCommentPanel({
  videoId,
  chapters,
  isLoggedIn,
  canPost,
  loginHref,
  settingsHref,
}: ChapterCommentPanelProps): React.ReactElement {
  const currentTime = usePlayerTime();

  const [composerOpen, setComposerOpen] = React.useState(false);
  const [draftTime, setDraftTime] = React.useState(0);
  const [submittedChapter, setSubmittedChapter] = React.useState<{
    chapterTime: number;
    label: string;
  } | null>(null);

  const openComposer = React.useCallback(() => {
    setDraftTime(currentTime);
    setComposerOpen(true);
  }, [currentTime]);

  const closeComposer = React.useCallback(() => {
    setComposerOpen(false);
  }, []);

  const handleSuccess = React.useCallback(
    (chapter: { chapterTime: number; label: string }) => {
      setSubmittedChapter(chapter);
      setComposerOpen(false);
    },
    [],
  );

  React.useEffect(() => {
    if (!submittedChapter) return;

    const timer = window.setTimeout(() => {
      scrollToSubmittedChapter(submittedChapter.chapterTime, 10);
      setSubmittedChapter(null);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [submittedChapter, chapters]);

  return (
    <section
      className={styles.root}
      aria-labelledby="chapter-comment-panel-title"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CHAPTERS</p>
          <h3 id="chapter-comment-panel-title" className={styles.title}>
            チャプター・コメント
          </h3>
        </div>

        <span className={styles.count}>{chapters.length}</span>
      </header>

      <div className={styles.list}>
        <ChapterTabs chapters={chapters} presentation="responsive" />
      </div>

      <div className={styles.composer}>
        {!composerOpen ? (
          <button
            type="button"
            className={styles.composeButton}
            onClick={openComposer}
          >
            <Icon name="plus" size={17} aria-hidden />
            現在位置にコメントする
          </button>
        ) : !isLoggedIn ? (
          <section className={styles.notice}>
            <p>コメントを投稿するにはログインしてください。</p>

            <Link href={loginHref} className="fn-btn fn-btn-primary">
              ログイン
            </Link>

            <button
              type="button"
              className="fn-btn fn-btn-ghost"
              onClick={closeComposer}
            >
              閉じる
            </button>
          </section>
        ) : !canPost ? (
          <section className={styles.notice}>
            <p>コメント投稿には承認済みX IDが必要です。</p>

            <Link href={settingsHref} className="fn-btn fn-btn-primary">
              X ID設定へ
            </Link>

            <button
              type="button"
              className="fn-btn fn-btn-ghost"
              onClick={closeComposer}
            >
              閉じる
            </button>
          </section>
        ) : (
          <ChapterComposer
            videoId={videoId}
            canPost
            canBulk={false}
            initialTime={draftTime}
            active={composerOpen}
            presentation="inline-sheet"
            settingsHref={settingsHref}
            onCancel={closeComposer}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </section>
  );
}
