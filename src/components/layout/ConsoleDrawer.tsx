"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ConsoleDrawer({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const restoreFocusRef = React.useRef(true);
  const [open, setOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    restoreFocusRef.current = false;
    setOpen(false);
  }, [pathname]);

  const close = React.useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  const drawerOpen = isMobile && open;

  React.useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    const focusTimer = window.setTimeout(() => first?.focus(), 0);

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
        aria-controls="fn-console-navigation-drawer"
        onClick={() => {
          restoreFocusRef.current = true;
          setOpen(true);
        }}
      >
        <Icon name="menu" size={18} aria-hidden />
        {label}
      </button>
      <div
        className="fn-console-drawer-backdrop"
        data-open={drawerOpen ? "true" : "false"}
        aria-hidden="true"
        onMouseDown={() => close()}
      />
      <aside
        ref={panelRef}
        id="fn-console-navigation-drawer"
        className="fn-console-drawer-panel"
        data-open={drawerOpen ? "true" : "false"}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen || undefined}
        aria-label={drawerOpen ? label : undefined}
        inert={isMobile && !drawerOpen ? true : undefined}
        tabIndex={-1}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a[href]")) {
            close(false);
          }
        }}
      >
        <button
          type="button"
          className="fn-console-drawer-close"
          onClick={() => close()}
          aria-label={`${label}を閉じる`}
        >
          <Icon name="close" size={18} aria-hidden />
        </button>
        {children}
      </aside>
    </div>
  );
}
