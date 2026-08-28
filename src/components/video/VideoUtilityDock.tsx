"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { PlaylistRail, type PlaylistEntry } from "./PlaylistRail";
import { ChapterCommentPanel } from "./ChapterCommentPanel";
import type { ChapterEntry } from "./ChapterTabs";
import { Icon } from "@/components/ui/Icon";
import { acquireBodyScrollLock } from "@/components/layout/bodyScrollLock";
import styles from "./VideoUtilityDock.module.css";

type ActivePanel = "playlist" | "chapters" | null;

interface VideoUtilityDockProps {
  videoId: string;
  currentId: string;

  playlistId?: string;
  playlistLabel: string;
  playlistItems: PlaylistEntry[];

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

const MOBILE_QUERY = "(max-width: 900px)";
const HISTORY_STATE_KEY = "fn-video-utility-dock";

export function VideoUtilityDock({
  videoId,
  currentId,
  playlistId,
  playlistLabel,
  playlistItems,
  chapters,
  isLoggedIn,
  authUnavailable,
  needsTermsAcceptance,
  canPost,
  loginHref,
  rulesHref,
  settingsHref,
  activeXId,
}: VideoUtilityDockProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const dockRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const historyOwnedRef = React.useRef(false);
  const closingViaProgramRef = React.useRef(false);
  const pendingNavigationRef = React.useRef<string | null>(null);

  const [activePanel, setActivePanel] =
    React.useState<ActivePanel>(null);

  const [isMobile, setIsMobile] = React.useState(false);

  const isOpen = isMobile && activePanel !== null;

  const releaseHistoryEntry = React.useCallback(() => {
    if (!historyOwnedRef.current) return;

    const currentState = window.history.state as
      | Record<string, unknown>
      | null;

    historyOwnedRef.current = false;

    if (!currentState?.[HISTORY_STATE_KEY]) {
      closingViaProgramRef.current = false;
      pendingNavigationRef.current = null;
      return;
    }

    closingViaProgramRef.current = true;
    window.history.back();
  }, []);

  React.useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);

    const update = () => {
      setIsMobile(media.matches);

      if (!media.matches) {
        setActivePanel(null);
        releaseHistoryEntry();
      }
    };

    update();
    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, [releaseHistoryEntry]);

  React.useEffect(() => {
    setActivePanel(null);
    historyOwnedRef.current = false;
    pendingNavigationRef.current = null;
  }, [pathname]);

  React.useEffect(() => {
    if (!isMobile || !isOpen || historyOwnedRef.current) return;
    const currentState = window.history.state;
    const baseState =
      currentState && typeof currentState === "object"
        ? (currentState as Record<string, unknown>)
        : {};
    // Next App Routerの__NA/tree等を上書きするとback/forwardが壊れるため、
    // 既存history stateを保持したままdock所有markerだけを追加する。
    window.history.pushState(
      { ...baseState, [HISTORY_STATE_KEY]: true },
      "",
    );
    historyOwnedRef.current = true;
  }, [isMobile, isOpen]);

  React.useEffect(() => {
    const onPopState = () => {
      if (closingViaProgramRef.current) {
        closingViaProgramRef.current = false;
        const pendingNavigation = pendingNavigationRef.current;
        pendingNavigationRef.current = null;
        if (pendingNavigation) {
          const nextUrl = new URL(pendingNavigation, window.location.href);
          if (nextUrl.origin === window.location.origin) {
            router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
          } else {
            window.location.assign(nextUrl.href);
          }
        }
        return;
      }
      setActivePanel(null);
      historyOwnedRef.current = false;
      pendingNavigationRef.current = null;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [router]);

  React.useEffect(() => {
    if (!isOpen) return;
    return acquireBodyScrollLock();
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  const closePanel = React.useCallback(() => {
    pendingNavigationRef.current = null;
    setActivePanel(null);
    releaseHistoryEntry();

    window.requestAnimationFrame(() => {
      previousTriggerRef.current?.focus();
    });
  }, [releaseHistoryEntry]);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePanel, isOpen]);

  const togglePanel = React.useCallback(
    (
      panel: Exclude<ActivePanel, null>,
      trigger: HTMLButtonElement,
    ) => {
      previousTriggerRef.current = trigger;

      if (activePanel === panel) {
        closePanel();
        return;
      }

      setActivePanel(panel);
    },
    [activePanel, closePanel],
  );

  const handlePanelNavigationCapture = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!isOpen || !historyOwnedRef.current) return;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const currentState = window.history.state as
        | Record<string, unknown>
        | null;
      if (!currentState?.[HISTORY_STATE_KEY]) return;

      // synthetic dock entryを残したままNext Linkがpushすると、戻る時に同じ動画URLを
      // 2回踏む。リンク遷移は一度synthetic entryをbackで消費し、popstate後に実行する。
      event.preventDefault();
      pendingNavigationRef.current = anchor.href;
      setActivePanel(null);
      releaseHistoryEntry();
    },
    [isOpen, releaseHistoryEntry],
  );

  return (
    <aside
      ref={dockRef}
      className={styles.dock}
      data-open={isOpen}
      aria-label="動画補助機能"
      onClickCapture={handlePanelNavigationCapture}
    >
      <div className={styles.sheet}>
        <header className={styles.sheetHeader}>
          <span className={styles.handle} aria-hidden />

          <strong className={styles.sheetTitle}>
            {activePanel === "playlist"
              ? "再生リスト"
              : "チャプター・コメント"}
          </strong>

          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={closePanel}
            aria-label="パネルを閉じる"
          >
            <Icon name="close" size={20} aria-hidden />
          </button>
        </header>

        <div className={styles.panelViewport}>
          <section
            id="video-utility-playlist"
            className={styles.panel}
            data-active={
              !isMobile || activePanel === "playlist"
            }
            aria-hidden={
              isMobile && activePanel !== "playlist"
            }
          >
            {playlistItems.length > 0 ? (
              <PlaylistRail
                label={playlistLabel}
                items={playlistItems}
                currentId={currentId}
                playlistId={playlistId}
                presentation="responsive"
              />
            ) : null}
          </section>

          <section
            id="video-utility-chapters"
            className={styles.panel}
            data-active={
              !isMobile || activePanel === "chapters"
            }
            aria-hidden={
              isMobile && activePanel !== "chapters"
            }
          >
            <ChapterCommentPanel
              active={!isMobile || activePanel === "chapters"}
              videoId={videoId}
              chapters={chapters}
              isLoggedIn={isLoggedIn}
              authUnavailable={authUnavailable}
              needsTermsAcceptance={needsTermsAcceptance}
              canPost={canPost}
              loginHref={loginHref}
              rulesHref={rulesHref}
              settingsHref={settingsHref}
              activeXId={activeXId}
            />
          </section>
        </div>
      </div>

      <nav
        className={styles.toolbar}
        aria-label="動画補助メニュー"
      >
        <DockButton
          icon="list"
          label="再生リスト"
          count={playlistItems.length}
          active={activePanel === "playlist"}
          disabled={playlistItems.length === 0}
          controls="video-utility-playlist"
          onClick={(event) => {
            togglePanel("playlist", event.currentTarget);
          }}
        />

        <DockButton
          icon="chapter"
          label="チャプター"
          count={chapters.length}
          active={activePanel === "chapters"}
          controls="video-utility-chapters"
          onClick={(event) => {
            togglePanel("chapters", event.currentTarget);
          }}
        />
      </nav>
    </aside>
  );
}

interface DockButtonProps {
  icon: "list" | "chapter";
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  controls: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

function DockButton({
  icon,
  label,
  count,
  active,
  disabled = false,
  controls,
  onClick,
}: DockButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.toolbarButton}
      data-active={active}
      disabled={disabled}
      aria-expanded={active}
      aria-controls={controls}
      onClick={onClick}
    >
      <span className={styles.toolbarIcon}>
        <Icon name={icon} size={20} aria-hidden />

        {count > 0 ? (
          <span className={styles.toolbarCount}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </span>

      <span className={styles.toolbarLabel}>{label}</span>
    </button>
  );
}
