"use client";

import * as React from "react";
import styles from "./ChapterTabs.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { ChapterCommentItem } from "./ChapterCommentItem";
import { findActiveChapterId } from "./chapterPlayback";
import { seekToTime } from "./playerBridge";
import { usePlayerTime } from "./usePlayerTime";

export interface ChapterEntry {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "public" | "private";
  marker_kind: "comment" | "chapter" | "review" | "system";
  note?: string | null;
  author_name?: string | null;
  author_icon?: string | null;
}

interface ChapterTabsProps {
  chapters: ChapterEntry[];
  duration?: number | null;
  onSeek?: (time: number) => void;
  presentation?: "rail" | "responsive";
  isVisible?: boolean;
}

const FOLLOW_IDLE_MS = 8_000;

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }

    node = node.parentElement;
  }
  return null;
}

export function ChapterTabs({
  chapters,
  duration,
  onSeek = seekToTime,
  presentation = "rail",
  isVisible = true,
}: ChapterTabsProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const currentTime = usePlayerTime();
  const [followPlayback, setFollowPlayback] = React.useState(true);
  const idleTimerRef = React.useRef<number | null>(null);
  const lastScrolledChapterIdRef = React.useRef<string | null>(null);
  const isAutoScrollingRef = React.useRef(false);

  const activeChapterId = React.useMemo(
    () => findActiveChapterId(chapters, currentTime),
    [chapters, currentTime],
  );

  const clearIdleTimer = React.useCallback(() => {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resumeFollow = React.useCallback(() => {
    clearIdleTimer();
    setFollowPlayback(true);
  }, [clearIdleTimer]);

  const pauseFollow = React.useCallback(() => {
    setFollowPlayback(false);
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => {
      setFollowPlayback(true);
      idleTimerRef.current = null;
    }, FOLLOW_IDLE_MS);
  }, [clearIdleTimer]);

  const handleSeek = React.useCallback(
    (time: number) => {
      resumeFollow();
      onSeek(time);
    },
    [onSeek, resumeFollow],
  );

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scrollParent = findScrollParent(root);
    if (!scrollParent) return;

    const onScroll = () => {
      if (isAutoScrollingRef.current) return;
      pauseFollow();
    };

    scrollParent.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollParent.removeEventListener("scroll", onScroll);
  }, [pauseFollow]);

  React.useEffect(() => {
    if (!isVisible || !followPlayback || !activeChapterId) {
      return;
    }
    if (lastScrolledChapterIdRef.current === activeChapterId) return;

    const root = rootRef.current;
    if (!root) return;

    const activeItem = root.querySelector<HTMLElement>(
      `[data-chapter-id="${CSS.escape(activeChapterId)}"]`,
    );
    if (!activeItem) return;

    isAutoScrollingRef.current = true;
    activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
    lastScrolledChapterIdRef.current = activeChapterId;
    window.setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 600);
  }, [activeChapterId, followPlayback, isVisible]);

  React.useEffect(() => {
    if (!followPlayback) {
      lastScrolledChapterIdRef.current = null;
    }
  }, [followPlayback]);

  React.useEffect(() => () => clearIdleTimer(), [clearIdleTimer]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-presentation={presentation}
    >
      <div className={styles.tabs}>
        {presentation !== "responsive" ? (
          <TabButton
            icon="chapter"
            label="チャプターコメント"
            count={chapters.length}
          />
        ) : null}
        {!followPlayback ? (
          <button
            type="button"
            className={styles.followButton}
            onClick={resumeFollow}
          >
            再生に追従
          </button>
        ) : null}
      </div>
      <div className={styles.list}>
        {chapters.length === 0 ? (
          <div className={styles.listEmpty}>
            チャプターコメントはまだありません。
          </div>
        ) : (
          chapters.map((c, index) => (
            <ChapterCommentItem
              key={`${c.id}-chapter-${index}`}
              chapter={c}
              duration={duration}
              showAuthor
              active={c.id === activeChapterId}
              onSeek={handleSeek}
            />
          ))
        )}
      </div>
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
