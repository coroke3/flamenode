"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { XIdEntry } from "@/lib/xid/entries";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { PublicAccountIsland, usePublicAccountSummary } from "@/components/layout/PublicAccountIsland";
import { navigateGetForm } from "@/components/forms/AutoSubmitSelect";
import { sanitizeNextPath } from "#utils/next";
import { useDismissablePanel } from "./useDismissablePanel";

const PUBLIC_NAV_ITEMS: {
  href: string;
  label: string;
  iconName: IconName;
}[] = [
  { href: "/list", label: "動画", iconName: "grid" },
  { href: "/user", label: "クリエイター", iconName: "users" },
  { href: "/event", label: "イベント", iconName: "calendar" },
];

function isPathActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type PublicHeaderUser = Pick<
  HeaderUser,
  "id" | "name" | "image" | "role" | "management"
> & {
  xIds: XIdEntry[];
};

interface PublicHeaderProps {
  /** 省略時はクライアントが /api/account/summary を取得する。 */
  user?: PublicHeaderUser | null;
  /**
   * SSRで最小ヘッダーを渡したまま、X ID一覧等を /api/account/summary で補完する。
   * 取得失敗でも serverUser のログイン表示は維持する。
   */
  hydrateAccount?: boolean;
}

export function PublicHeader({
  user: serverUser,
  hydrateAccount = false,
}: PublicHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [accountOpen, setAccountOpen] =
    React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchPanelRef = React.useRef<HTMLDivElement>(null);
  const menuButtonRef =
    React.useRef<HTMLButtonElement>(null);
  const mobilePanelRef =
    React.useRef<HTMLElement>(null);
  const searchButtonRef =
    React.useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const fetchAccount = serverUser === undefined || hydrateAccount;
  const preserveLoggedInOnFailure = hydrateAccount && serverUser != null;
  const { user: fetchedUser, loading: accountLoading } =
    usePublicAccountSummary(fetchAccount, preserveLoggedInOnFailure);
  const showAccountLoading = fetchAccount && accountLoading && !preserveLoggedInOnFailure;
  const accountUser =
    serverUser === undefined
      ? fetchedUser
      : fetchedUser && serverUser
        ? {
            ...serverUser,
            ...fetchedUser,
            id: serverUser.id || fetchedUser.id,
            name: fetchedUser.name || serverUser.name,
            image: fetchedUser.image ?? serverUser.image,
            role: fetchedUser.role || serverUser.role,
            xIds: fetchedUser.xIds.length > 0 ? fetchedUser.xIds : serverUser.xIds,
            // degraded 応答の canAccessManage=false で SSR 権限を潰さない。
            management:
              "degraded" in fetchedUser && fetchedUser.degraded
                ? {
                    canAccessAdmin:
                      fetchedUser.management.canAccessAdmin ||
                      serverUser.management.canAccessAdmin,
                    canAccessManage:
                      fetchedUser.management.canAccessManage ||
                      serverUser.management.canAccessManage,
                    manageableEventCount:
                      serverUser.management.manageableEventCount ?? 0,
                  }
                : fetchedUser.management ?? serverUser.management,
          }
        : serverUser;
  const entryNext = sanitizeNextPath(pathname ?? "/", "/");
  const entryHref =
    entryNext === "/entry"
      ? "/entry"
      : `/entry?next=${encodeURIComponent(entryNext)}`;

  useDismissablePanel({
    open: mobileOpen,
    onClose: React.useCallback(
      () => setMobileOpen(false),
      [],
    ),
    panelRef: mobilePanelRef,
    triggerRef: menuButtonRef,
    routeKey: pathname ?? "",
    lockBody: true,
    initialFocusMode: "panel",
  });

  useDismissablePanel({
    open: searchOpen,
    onClose: React.useCallback(
      () => setSearchOpen(false),
      [],
    ),
    panelRef: searchPanelRef,
    triggerRef: searchButtonRef,
    routeKey: pathname ?? "",
    initialFocusMode: "first",
  });

  const closeMobilePanels = () => {
    setMobileOpen(false);
    setSearchOpen(false);
  };

  return (
    <header className={`fn-header ${styles.header}`}>
      <div className={`fn-public-container fn-header-inner ${styles.bar}`}>
        <Link
          href="/"
          className={`fn-logo ${styles.logoLink}`}
          aria-label="FlameNode トップへ"
        >
          <Logo />
        </Link>

        <nav
          className={`fn-nav ${styles.desktopNav}`}
          aria-label="メインナビゲーション"
        >
          {PUBLIC_NAV_ITEMS.map((item) => {
            const active = isPathActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`fn-nav-item fn-nav-ja ${styles.desktopNavLink} ${
                  active ? `is-active ${styles.desktopNavLinkActive}` : ""
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={`fn-header-right ${styles.right}`}>
          <div className={`${styles.themeButton}`}>
            <ThemeToggle />
          </div>

          <button
            type="button"
            ref={searchButtonRef}
            className={`${styles.searchToggle}`}
            aria-label="作品を検索"
            aria-expanded={searchOpen}
            aria-controls="header-search-panel"
            onClick={() => {
              setSearchOpen((open) => !open);
              setMobileOpen(false);
              setAccountOpen(false);
            }}
          >
            <Icon name="search" size={18} aria-hidden />
          </button>

          <PublicAccountIsland
            user={accountUser}
            loading={showAccountLoading}
            entryHref={entryHref}
            accountOpen={accountOpen}
            onAccountOpenChange={(open) => {
              setAccountOpen(open);
              if (open) {
                setMobileOpen(false);
                setSearchOpen(false);
              }
            }}
            onClosePanels={closeMobilePanels}
            pathname={pathname}
            variant="desktop"
          />

          <button
            type="button"
            ref={menuButtonRef}
            className={styles.menuToggle}
            aria-label="メニューを開く"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation-panel"
            onClick={() => {
              setMobileOpen((open) => !open);
              setSearchOpen(false);
              setAccountOpen(false);
            }}
          >
            <Icon name={mobileOpen ? "close" : "menu"} size={18} />
          </button>
        </div>
      </div>

      <div
        id="header-search-panel"
        ref={searchPanelRef}
        className={`${styles.searchPanel} ${
          searchOpen ? styles.searchPanelOpen : ""
        }`}
        hidden={!searchOpen}
      >
        <form
          action="/list"
          method="get"
          className={`fn-public-container ${styles.searchPanelForm}`}
          role="search"
          aria-label="作品検索"
          onSubmit={(e) => {
            e.preventDefault();
            navigateGetForm(e.currentTarget);
            setSearchOpen(false);
          }}
        >
          <label htmlFor="header-search-input" className="fn-sr-only">
            作品を検索
          </label>
          <input
            id="header-search-input"
            ref={searchInputRef}
            type="search"
            name="q"
            placeholder="作品を検索"
            autoComplete="off"
          />
          <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
            検索
          </button>
          <button
            type="button"
            className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.searchClose}`}
            aria-label="検索を閉じる"
            onClick={() => setSearchOpen(false)}
          >
            <Icon name="close" size={14} aria-hidden />
          </button>
        </form>
      </div>

      <div className={`${styles.mobile} ${mobileOpen ? styles.mobileOpen : ""}`}>
        <nav
          id="mobile-navigation-panel"
          ref={mobilePanelRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={`fn-public-container ${styles.mobileNav}`}
          aria-label="モバイルナビゲーション"
          aria-hidden={!mobileOpen}
          inert={!mobileOpen}
        >
          <div className={styles.mobileSection}>
            <form
              action="/list"
              method="get"
              className={styles.mobileSearch}
              role="search"
              aria-label="作品検索"
              onSubmit={(e) => {
                e.preventDefault();
                navigateGetForm(e.currentTarget);
                closeMobilePanels();
              }}
            >
              <Icon name="search" size={16} aria-hidden />
              <label htmlFor="mobile-header-search-input" className="fn-sr-only">
                作品を検索
              </label>
              <input
                id="mobile-header-search-input"
                type="search"
                name="q"
                placeholder="作品を検索"
                autoComplete="off"
              />
            </form>
            <PublicAccountIsland
              user={accountUser}
              loading={showAccountLoading}
              entryHref={entryHref}
              accountOpen={accountOpen}
              onAccountOpenChange={setAccountOpen}
              onClosePanels={closeMobilePanels}
              pathname={pathname}
              variant="mobile-cta"
            />
          </div>

          <div className={styles.mobileDivider} />

          <PublicAccountIsland
            user={accountUser}
            loading={showAccountLoading}
            entryHref={entryHref}
            accountOpen={accountOpen}
            onAccountOpenChange={setAccountOpen}
            onClosePanels={closeMobilePanels}
            pathname={pathname}
            variant="mobile-nav"
          />
        </nav>
      </div>
    </header>
  );
}
