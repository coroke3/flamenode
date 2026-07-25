"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { PlaylistRail, type PlaylistEntry } from "./PlaylistRail";
import { ChapterCommentPanel } from "./ChapterCommentPanel";
import type { ChapterEntry } from "./ChapterTabs";
import { Icon } from "@/components/ui/Icon";
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
  canPost: boolean;

  loginHref: string;
  settingsHref: string;
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
  canPost,
  loginHref,
  settingsHref,
}: VideoUtilityDockProps): React.ReactElement {
  const pathname = usePathname();
  const dockRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const historyOwnedRef = React.useRef(false);
  const closingViaProgramRef = React.useRef(false);

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

  React.useLayoutEffect(() => {
    const dock = dockRef.current;
    const player = document.querySelector<HTMLElement>(
      "[data-video-player-boundary]",
    );

    if (!dock || !player) return;

    let frame = 0;

    const updateMetrics = () => {
      window.cancelAnimationFrame(frame);

      frame = window.requestAnimationFrame(() => {
        const playerRect = player.getBoundingClientRect();
        const visualViewport = window.visualViewport;

        const viewportHeight =
          visualViewport?.height ?? window.innerHeight;

        const viewportOffsetTop =
          visualViewport?.offsetTop ?? 0;

        const rootStyles = window.getComputedStyle(
          document.documentElement,
        );
        const configuredHeaderHeight = Number.parseFloat(
          rootStyles.getPropertyValue("--header-h"),
        );
        const headerHeight = Number.isFinite(configuredHeaderHeight)
          ? configuredHeaderHeight
          : 56;

        const keyboardInset = visualViewport
          ? Math.max(
              0,
              window.innerHeight -
                visualViewport.height -
                visualViewport.offsetTop,
            )
          : 0;

        const minTop = viewportOffsetTop + headerHeight;

        const maxTop =
          viewportOffsetTop +
          viewportHeight -
          160;

        const playerBottom = Math.max(
          minTop,
          Math.min(playerRect.bottom, maxTop),
        );

        dock.style.setProperty(
          "--fn-video-player-bottom",
          `${Math.round(playerBottom)}px`,
        );

        dock.style.setProperty(
          "--fn-keyboard-inset",
          `${Math.round(keyboardInset)}px`,
        );
      });
    };

    const resizeObserver = new ResizeObserver(updateMetrics);

    resizeObserver.observe(player);
    updateMetrics();

    window.addEventListener("resize", updateMetrics);
    window.addEventListener("scroll", updateMetrics, {
      passive: true,
    });
    window.addEventListener(
      "orientationchange",
      updateMetrics,
    );

    window.visualViewport?.addEventListener(
      "resize",
      updateMetrics,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      updateMetrics,
    );

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();

      window.removeEventListener("resize", updateMetrics);
      window.removeEventListener("scroll", updateMetrics);
      window.removeEventListener(
        "orientationchange",
        updateMetrics,
      );

      window.visualViewport?.removeEventListener(
        "resize",
        updateMetrics,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        updateMetrics,
      );
    };
  }, []);

  React.useEffect(() => {
    setActivePanel(null);
    historyOwnedRef.current = false;
  }, [pathname]);

  React.useEffect(() => {
    if (!isMobile || !isOpen || historyOwnedRef.current) return;
    window.history.pushState({ [HISTORY_STATE_KEY]: true }, "");
    historyOwnedRef.current = true;
  }, [isMobile, isOpen]);

  React.useEffect(() => {
    const onPopState = () => {
      if (closingViaProgramRef.current) {
        closingViaProgramRef.current = false;
        return;
      }
      setActivePanel(null);
      historyOwnedRef.current = false;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;

    const scrollY = window.scrollY;
    const body = document.body;

    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;

      window.scrollTo(0, scrollY);
    };
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

  return (
    <aside
      ref={dockRef}
      className={styles.dock}
      data-open={isOpen}
      aria-label="動画補助機能"
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
            ) : (
              <p className={styles.empty}>
                再生リストはありません。
              </p>
            )}
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
              canPost={canPost}
              loginHref={loginHref}
              settingsHref={settingsHref}
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
