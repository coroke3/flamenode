"use client";

import * as React from "react";
import Link from "next/link";
import { ChapterTabs, type ChapterEntry } from "./ChapterTabs";
import { ChapterComposer } from "./ChapterComposer";
import { usePlayerTime } from "./usePlayerTime";
import { Icon } from "@/components/ui/Icon";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";
import { notifyVideoViewerOverlayChanged } from "@/lib/video/videoViewerOverlayClient";
import styles from "./ChapterCommentPanel.module.css";

interface ChapterCommentPanelProps {
  active: boolean;
  videoId: string;
  chapters: ChapterEntry[];
  isLoggedIn: boolean;
  authUnavailable: boolean;
  needsTermsAcceptance: boolean;
  canPost: boolean;
  loginHref: string;
  rulesHref: string;
  settingsHref: string;
  activeXId?: string | null;
}

export function ChapterCommentPanel({
  active,
  videoId,
  chapters,
  isLoggedIn,
  authUnavailable,
  needsTermsAcceptance,
  canPost,
  loginHref,
  rulesHref,
  settingsHref,
  activeXId,
}: ChapterCommentPanelProps): React.ReactElement {
  const rootRef = React.useRef<HTMLElement>(null);
  const currentTime = usePlayerTime();

  const [composerOpen, setComposerOpen] = React.useState(false);
  const [draftTime, setDraftTime] = React.useState(0);
  const [submittedChapter, setSubmittedChapter] = React.useState<{
    chapterTime: number;
    label: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const [reflectionNotice, setReflectionNotice] = React.useState(false);

  const openComposer = React.useCallback(() => {
    setDraftTime(currentTime);
    setComposerOpen(true);
    setReflectionNotice(false);
  }, [currentTime]);

  const closeComposer = React.useCallback(() => {
    setComposerOpen(false);
  }, []);

  const handleSuccess = React.useCallback(
    (chapter: {
      chapterTime: number;
      label: string;
      pendingPublicReflection?: boolean;
    }) => {
      // Public video SSRはviewer D1を読まないためrouter.refresh()だけでは
      // 30秒のprivate overlay cacheが残る。書込直後に狭いviewer APIだけ再取得し、
      // private chapterを即時反映する。public chapterはR2反映待ちnoticeを維持する。
      notifyVideoViewerOverlayChanged(videoId);
      setSubmittedChapter(chapter);
      setReflectionNotice(chapter.pendingPublicReflection === true);
      setComposerOpen(false);
    },
    [videoId],
  );

  React.useEffect(() => {
    if (!submittedChapter || !active) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    const targetTime = Math.floor(submittedChapter.chapterTime);

    const findAndScroll = () => {
      if (cancelled) return;

      const item = rootRef.current?.querySelector<HTMLElement>(
        `[data-chapter-time="${targetTime}"]`,
      );

      if (item) {
        item.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
        setSubmittedChapter(null);
        return;
      }

      attempts += 1;

      if (attempts >= 10) {
        setSubmittedChapter(null);
        return;
      }

      timeoutId = window.setTimeout(findAndScroll, 200);
    };

    timeoutId = window.setTimeout(findAndScroll, 250);

    return () => {
      cancelled = true;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [active, submittedChapter, chapters]);

  return (
    <section
      ref={rootRef}
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
        {reflectionNotice ? (
          <div style={{ marginBottom: 8 }}>
            <PublicReflectionDelayNotice />
          </div>
        ) : null}
        <ChapterTabs
          chapters={chapters}
          presentation="responsive"
          isVisible={active}
        />
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
        ) : authUnavailable ? (
          <section className={styles.notice}>
            <p>
              ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。
            </p>

            <button
              type="button"
              className="fn-btn fn-btn-ghost"
              onClick={closeComposer}
            >
              閉じる
            </button>
          </section>
        ) : !isLoggedIn ? (
          <section className={styles.notice}>
            <p>コメントを投稿するにはログインしてください。</p>

            <Link
              href={loginHref}
              className="fn-btn fn-btn-primary"
              prefetch={false}
            >
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
        ) : needsTermsAcceptance ? (
          <section className={styles.notice}>
            <p>コメントを投稿するには利用規約への同意が必要です。</p>

            <Link
              href={rulesHref}
              className="fn-btn fn-btn-primary"
              prefetch={false}
            >
              利用規約へ
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

            <Link
              href={settingsHref}
              className="fn-btn fn-btn-primary"
              prefetch={false}
            >
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
            key={`chapter:${videoId}:${activeXId ?? "unassigned"}`}
            videoId={videoId}
            canPost
            canBulk={false}
            initialTime={draftTime}
            active={composerOpen}
            presentation="inline-sheet"
            settingsHref={settingsHref}
            activeXId={activeXId}
            onCancel={closeComposer}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </section>
  );
}
