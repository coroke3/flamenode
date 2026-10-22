import React from "react";
import { Link } from "../adapters/index.js";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "../navigation/publicNavigation.js";
import { openDialogBehavior } from "../components/Dialog.js";
import { ImeSafeGetForm } from "../forms/ImeSafeGetForm.js";

/**
 * Public header from the registered mock (`docs/migration/mock/source/boards/PublicHeader.dc.html`,
 * classes `hd2` / `hd-*`, styles in `styles/layout.css`). Entry points follow CURRENT
 * `src/components/layout/PublicHeader.tsx`: logo, the 3 nav items, work search, theme, account, menu.
 */
export interface PublicHeaderProps {
  currentPath?: string;
  className?: string;
  /** Theme switch (CURRENT `ThemeToggle`). It needs client state, so the page passes its own Island. */
  themeToggle?: React.ReactNode;
  /** Login / account menu (CURRENT `PublicAccountIsland`, a Phase 5 Island). The header never reads auth state. */
  account?: React.ReactNode;
  /** Account entries inside the mobile menu; CURRENT shows the account section there too. */
  mobileAccount?: React.ReactNode;
}

const ICON_PATHS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.35-4.35",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
} as const;

function HeaderIcon({ name }: { name: keyof typeof ICON_PATHS }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// CURRENT `src/components/layout/useDismissablePanel.ts` FOCUSABLE.
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * CURRENT useDismissablePanel outside press (UX-GLOBAL-015): a pointerdown anywhere but inside
 * one of `getInside()` closes. The toggle button is listed as inside, so its own click toggles.
 */
function closeOnOutsidePointerDown(
  getInside: () => readonly (Element | null)[],
  close: () => void,
): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (getInside().some((element) => element?.contains(target))) return;
    close();
  };
  window.addEventListener("pointerdown", onPointerDown);
  return () => window.removeEventListener("pointerdown", onPointerDown);
}

export function PublicHeader({
  currentPath,
  className,
  themeToggle,
  account,
  mobileAccount,
}: PublicHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const menuScrimRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchButtonRef = React.useRef<HTMLButtonElement>(null);
  // Unique per header, so two headers on one page never share ids.
  const baseId = React.useId();
  const menuId = `${baseId}-menu`;
  const searchId = `${baseId}-search`;

  React.useEffect(() => {
    if (!menuOpen) return;
    return openDialogBehavior(menuRef.current, menuButtonRef.current, () => () => setMenuOpen(false));
  }, [menuOpen]);

  // The menu is aria-modal, so Tab stays inside it and a press outside closes it
  // (CURRENT useDismissablePanel, UX-GLOBAL-015/016). Esc is handled by openDialogBehavior.
  React.useEffect(() => {
    const panel = menuRef.current;
    if (!menuOpen || !panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled") && element.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      // The menu itself has focus right after opening; Shift+Tab from there goes to the last item.
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // The scrim closes on its own click, so that tap is not passed to the page under it (touch).
    const stopOutsideClose = closeOnOutsidePointerDown(
      () => [panel, menuButtonRef.current, menuScrimRef.current],
      () => setMenuOpen(false),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopOutsideClose();
    };
  }, [menuOpen]);

  // The menu exists only below 641px (styles/layout.css). Widening the viewport hides it with CSS,
  // so close it here too, or the body scroll lock and the focus trap would stay on.
  React.useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia("(min-width: 641px)");
    if (wide.matches) {
      setMenuOpen(false);
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [menuOpen]);

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // CURRENT useDismissablePanel for the search panel: Esc anywhere closes it and returns focus to
  // the button (the field becomes display:none), and a press outside the form and the button closes it.
  React.useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return; // IME conversion uses Esc
      event.preventDefault();
      setSearchOpen(false);
      searchButtonRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    // ImeSafeGetForm takes no ref, so the form is found by its id.
    const stopOutsideClose = closeOnOutsidePointerDown(
      () => [document.getElementById(searchId), searchButtonRef.current],
      () => setSearchOpen(false),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopOutsideClose();
    };
  }, [searchOpen, searchId]);

  return (
    <header className={cx("hd2", searchOpen && "open-search", className)} lang="ja">
      <div className="hd-bar">
        <Link href="/" className="hd-logo" aria-label="FlameNode トップへ">
          <span>FlameNode</span>
        </Link>

        <nav className="hd-nav" aria-label="メインナビゲーション">
          {PUBLIC_NAV_ITEMS.map((item) => {
            const active = isPublicNavItemActive(currentPath ?? null, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hd-right">
          {/* CURRENT: ImeSafeGetForm GET /list?q=. Before hydration it is a plain GET form. */}
          <ImeSafeGetForm
            id={searchId}
            className="hd-search"
            action="/list"
            method="get"
            role="search"
            aria-label="作品検索"
            onNavigated={() => setSearchOpen(false)}
          >
            <label htmlFor={`${searchId}-q`} className="fn-sr-only">作品を検索</label>
            <input
              ref={searchInputRef}
              id={`${searchId}-q`}
              type="search"
              name="q"
              placeholder="作品を検索"
              autoComplete="off"
              enterKeyHint="search"
            />
          </ImeSafeGetForm>
          <button
            ref={searchButtonRef}
            type="button"
            className="ib hd-search-ic"
            aria-label={searchOpen ? "検索を閉じる" : "作品を検索"}
            aria-expanded={searchOpen}
            aria-controls={searchId}
            onClick={() => {
              setSearchOpen((open) => !open);
              setMenuOpen(false);
            }}
          >
            <HeaderIcon name={searchOpen ? "close" : "search"} />
          </button>
          {themeToggle ? <div className="hd-theme">{themeToggle}</div> : null}
          {account ? <div className="hd-account">{account}</div> : null}
          <button
            ref={menuButtonRef}
            type="button"
            className={cx("ib", "hd-burger", menuOpen && "on")}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
            onClick={() => {
              setMenuOpen((open) => !open);
              setSearchOpen(false);
            }}
          >
            <HeaderIcon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <div
            id={menuId}
            ref={menuRef}
            className="hd-menu"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            tabIndex={-1}
          >
            <nav className="hm-main" aria-label="モバイルナビゲーション">
              {PUBLIC_NAV_ITEMS.map((item) => {
                const active = isPublicNavItemActive(currentPath ?? null, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            {mobileAccount ? <div className="hm-me">{mobileAccount}</div> : null}
          </div>
          <div ref={menuScrimRef} className="hd-menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />
        </>
      )}
    </header>
  );
}
