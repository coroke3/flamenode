import React from "react";
import { Link } from "../adapters/index.js";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "../navigation/publicNavigation.js";
import { openDialogBehavior } from "../components/Dialog.js";

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
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  // Unique per header, so two headers on one page never share ids.
  const baseId = React.useId();
  const menuId = `${baseId}-menu`;
  const searchId = `${baseId}-search`;

  React.useEffect(() => {
    if (!menuOpen) return;
    return openDialogBehavior(menuRef.current, menuButtonRef.current, () => () => setMenuOpen(false));
  }, [menuOpen]);

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
          {/* Same target as CURRENT ImeSafeGetForm: GET /list?q=. A native submit works
              before hydration and does not fire while an IME composition is open. */}
          <form
            id={searchId}
            className="hd-search"
            action="/list"
            method="get"
            role="search"
            aria-label="作品検索"
            onSubmit={() => setSearchOpen(false)}
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
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.nativeEvent.isComposing) setSearchOpen(false);
              }}
            />
          </form>
          <button
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
          <div className="hd-menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />
        </>
      )}
    </header>
  );
}
