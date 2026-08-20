"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { safeDecodeURIComponent } from "@/lib/utils/url";

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const ACTIVE_LINK = 'a[aria-current="page"], a[data-active="true"]';

function fallbackConsolePageLabel(
  pathname: string,
): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeURIComponent(segment) ?? segment);

  if (segments[0] === "manage") {
    const eventIndex = segments.indexOf("events");

    if (eventIndex >= 0 && segments[eventIndex + 1]) {
      const eventId = segments[eventIndex + 1];
      const child = segments[eventIndex + 2];

      const childLabels: Record<string, string> = {
        staff: "スタッフ",
        slots: "枠管理",
        videos: "作品管理",
        review: "審査",
        settings: "設定",
      };

      return child
        ? `${eventId} / ${
            childLabels[child] ?? child
          }`
        : eventId;
    }

    return "イベント運営";
  }

  const adminLabels: Record<string, string> = {
    admin: "サイト管理",
    events: "イベント",
    videos: "作品",
    users: "ユーザー",
    audit: "監査ログ",
    system: "システム",
    settings: "設定",
  };

  const last = segments.at(-1) ?? "admin";
  return adminLabels[last] ?? last;
}

export function ConsoleDrawer({
  label,
  modeLabel,
  children,
}: {
  label: string;
  modeLabel: string;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const drawerId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const restoreFocusRef = React.useRef(true);
  const [open, setOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const [currentPageLabel, setCurrentPageLabel] =
    React.useState(() =>
      fallbackConsolePageLabel(pathname),
    );

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      const mobile = media.matches;
      setIsMobile(mobile);
      if (!mobile) {
        // デスクトップへ戻るとトリガーが非表示になるため、そこへ復帰させない。
        restoreFocusRef.current = false;
        setOpen(false);
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    restoreFocusRef.current = false;
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeLink =
        panelRef.current?.querySelector<HTMLElement>(
          ACTIVE_LINK,
        );

      const activeText =
        activeLink?.textContent
          ?.replace(/\s+/g, " ")
          .trim() ?? "";

      setCurrentPageLabel(
        activeText ||
          fallbackConsolePageLabel(pathname),
      );
    });

    return () =>
      window.cancelAnimationFrame(frame);
  }, [pathname]);

  const close = React.useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  const drawerOpen = isMobile && open;

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.inert = isMobile && !drawerOpen;
  }, [drawerOpen, isMobile]);

  React.useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    const active = panel?.querySelector<HTMLElement>(ACTIVE_LINK);
    const focusTimer = window.setTimeout(() => {
      active?.scrollIntoView({ block: "center" });
      first?.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocusRef.current) trigger?.focus();
      restoreFocusRef.current = true;
    };
  }, [close, drawerOpen]);

  return (
    <div className="fn-console-navigation">
      <button
        ref={triggerRef}
        type="button"
        className="fn-console-drawer-trigger"
        aria-expanded={drawerOpen}
        aria-controls={drawerId}
        aria-haspopup="dialog"
        aria-label={`${label}を開く。現在: ${currentPageLabel}`}
        onClick={() => {
          restoreFocusRef.current = true;
          setOpen(true);
        }}
      >
        <Icon name="menu" size={18} aria-hidden />
        <span className="fn-console-trigger-copy">
          <span className="fn-console-trigger-mode">
            {modeLabel}
          </span>
          <strong>{currentPageLabel}</strong>
          <small>{pathname}</small>
        </span>
      </button>
      <div
        className="fn-console-drawer-backdrop"
        data-open={drawerOpen ? "true" : "false"}
        onClick={() => close()}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        id={drawerId}
        className="fn-console-drawer-panel"
        data-open={drawerOpen ? "true" : "false"}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-hidden={isMobile && !drawerOpen ? true : undefined}
        aria-label={label}
        tabIndex={-1}
        onClickCapture={(event) => {
          if (!drawerOpen) return;
          const target = event.target;
          if (target instanceof Element && target.closest("a[href]")) {
            close(false);
          }
        }}
      >
        <div className="fn-console-drawer-head">
          <strong>{label}</strong>
          <button
            type="button"
            className="fn-console-drawer-close"
            aria-label={`${label}を閉じる`}
            onClick={() => close()}
          >
            <Icon name="close" size={16} aria-hidden />
            閉じる
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
