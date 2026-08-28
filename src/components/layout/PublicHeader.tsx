"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { XIdEntry } from "@/lib/xid/entries";
import type { HeaderUser } from "@/lib/auth/headerUser";
import {
  PublicAccountIsland,
  usePublicAccountSummary,
} from "@/components/layout/PublicAccountIsland";
import { ImeSafeGetForm } from "@/components/forms/ImeSafeGetForm";
import { sanitizeNextPath } from "#utils/next";
import { useDismissablePanel } from "./useDismissablePanel";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "./publicNavigation";

export type PublicHeaderUser = Pick<
  HeaderUser,
  "id" | "name" | "image" | "role" | "management"
> & {
  xIds: XIdEntry[];
};

interface PublicHeaderProps {
  /** 省略時は必要になった時だけクライアントが /api/account/summary を取得する。 */
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
  const [accountOpen, setAccountOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchPanelRef = React.useRef<HTMLDivElement>(null);
  const mobileHeaderRef = React.useRef<HTMLElement>(null);
  const mobileHeaderHeightRef = React.useRef<number | null>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobileScrollRef = React.useRef<HTMLDivElement>(null);
  const mobilePanelRef = React.useRef<HTMLElement>(null);
  const searchButtonRef = React.useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const fetchAccount = serverUser === undefined || hydrateAccount;
  const preserveLoggedInOnFailure = hydrateAccount && serverUser != null;
  const publicClientAccount = serverUser === undefined && !hydrateAccount;
  // SSR最小ヘッダーと公開ヘッダーのどちらも、summaryはユーザーが
  // アカウントUI/モバイルナビを開いた時だけ取得する。公開ページを読むだけの
  // 匿名requestからAuth.js fan-outを完全に外す。
  const hydrateOnOpen =
    (hydrateAccount && serverUser != null) || publicClientAccount;
  const accountHydrationOpen = accountOpen || mobileOpen;
  const {
    user: fetchedUser,
    loading: accountLoading,
    unavailable: accountUnavailable,
    confirmedLoggedOut: accountConfirmedLoggedOut,
  } = usePublicAccountSummary(
    fetchAccount,
    preserveLoggedInOnFailure,
    hydrateOnOpen,
    accountHydrationOpen,
    false,
  );
  const accountUnknown =
    publicClientAccount &&
    !accountConfirmedLoggedOut &&
    fetchedUser == null &&
    !accountUnavailable &&
    !accountLoading;
  const showAccountLoading =
    fetchAccount &&
    (accountLoading || (publicClientAccount && mobileOpen && accountUnknown)) &&
    !preserveLoggedInOnFailure;
  const showAccountUnavailable =
    fetchAccount && accountUnavailable && !preserveLoggedInOnFailure;
  const accountUser = accountConfirmedLoggedOut
    ? null
    : serverUser === undefined
      ? fetchedUser
      : fetchedUser
        ? serverUser
          ? {
              ...serverUser,
              ...fetchedUser,
              id: serverUser.id || fetchedUser.id,
              name: fetchedUser.name || serverUser.name,
              image: fetchedUser.image ?? serverUser.image,
              role: fetchedUser.role || serverUser.role,
              // 正常/degraded summaryのlinked X rowsはどちらもDB正本。
              // 空配列も「現在リンクなし」という有効な結果なのでSSRの古いActive Xへ戻さない。
              xIds: fetchedUser.xIds,
              management:
                "degraded" in fetchedUser && fetchedUser.degraded
                  ? {
                      // degraded summaryでもrole自体はcurrentUserのDB正本。
                      // SSR時の古いadmin=trueをORして、降格後に管理リンクを復活させない。
                      canAccessAdmin: fetchedUser.management.canAccessAdmin,
                      // event staff権限だけは補助query失敗時に不明なのでSSR結果を維持する。
                      // 実際の/manage認可はserver-side gateで再検証される。
                      canAccessManage:
                        fetchedUser.management.canAccessManage ||
                        serverUser.management.canAccessManage,
                      manageableEventCount:
                        serverUser.management.manageableEventCount ?? 0,
                    }
                  : fetchedUser.management ?? serverUser.management,
            }
          : fetchedUser
        : serverUser;
  const entryNext = sanitizeNextPath(pathname ?? "/", "/");
  const entryHref =
    entryNext === "/entry"
      ? "/entry"
      : `/entry?next=${encodeURIComponent(entryNext)}`;

  React.useLayoutEffect(() => {
    if (!mobileOpen) return;

    const mobileScroll = mobileScrollRef.current;
    if (!mobileScroll) return;

    mobileScroll.scrollTop = 0;
    mobileScroll.scrollLeft = 0;
  }, [mobileOpen]);

  useDismissablePanel({
    open: mobileOpen,
    onClose: React.useCallback(() => setMobileOpen(false), []),
    panelRef: mobilePanelRef,
    triggerRef: menuButtonRef,
    routeKey: pathname ?? "",
    lockBody: true,
    initialFocusMode: "panel",
  });

  useDismissablePanel({
    open: searchOpen,
    onClose: React.useCallback(() => setSearchOpen(false), []),
    panelRef: searchPanelRef,
    triggerRef: searchButtonRef,
    routeKey: pathname ?? "",
    initialFocusMode: "first",
  });

  const closeMobilePanels = () => {
    setMobileOpen(false);
    setSearchOpen(false);
  };

  const openAccountProbe = () => {
    setAccountOpen(true);
    setMobileOpen(false);
    setSearchOpen(false);
  };

  return (
    <>
      {mobileOpen ? (
        <div
          className={styles.headerMenuSpacer}
          style={
            mobileHeaderHeightRef.current == null
              ? undefined
              : { height: mobileHeaderHeightRef.current }
          }
          aria-hidden="true"
        />
      ) : null}
      <header
        ref={mobileHeaderRef}
        className={`fn-header ${styles.header} ${
          mobileOpen ? styles.headerMenuOpen : ""
        }`}
      >
        <div className={`fn-public-container fn-header-inner ${styles.bar}`}>
          <Link
            href="/"
            className={`fn-logo ${styles.logoLink}`}
            aria-label="FlameNode トップへ"
            prefetch={false}
          >
            <Logo />
          </Link>

          <nav
            className={`fn-nav ${styles.desktopNav}`}
            aria-label="メインナビゲーション"
          >
            {PUBLIC_NAV_ITEMS.map((item) => {
              const active = isPublicNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`fn-nav-item fn-nav-ja ${styles.desktopNavLink} ${
                    active ? `is-active ${styles.desktopNavLinkActive}` : ""
                  }`}
                  aria-current={active ? "page" : undefined}
                  prefetch={false}
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

            {accountUnknown ? (
              <button
                type="button"
                className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.headerCta}`}
                onClick={openAccountProbe}
                aria-label="アカウントを確認"
              >
                <Icon name="user" size={13} aria-hidden />
                <span>アカウント</span>
              </button>
            ) : (
              <PublicAccountIsland
                user={accountUser}
                loading={showAccountLoading}
                unavailable={showAccountUnavailable}
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
            )}

            <button
              type="button"
              ref={menuButtonRef}
              className={styles.menuToggle}
              aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation-panel"
              onClick={() => {
                if (!mobileOpen) {
                  mobileHeaderHeightRef.current =
                    mobileHeaderRef.current?.getBoundingClientRect().height ?? null;
                }
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
          <ImeSafeGetForm
            action="/list"
            method="get"
            className={`fn-public-container ${styles.searchPanelForm}`}
            role="search"
            aria-label="作品検索"
            onNavigated={() => setSearchOpen(false)}
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
          </ImeSafeGetForm>
        </div>

        <div
          ref={mobileScrollRef}
          className={`${styles.mobile} ${mobileOpen ? styles.mobileOpen : ""}`}
        >
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
              <ImeSafeGetForm
                action="/list"
                method="get"
                className={styles.mobileSearch}
                role="search"
                aria-label="作品検索"
                onNavigated={() => closeMobilePanels()}
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
              </ImeSafeGetForm>
              <PublicAccountIsland
                user={accountUser}
                loading={showAccountLoading}
                unavailable={showAccountUnavailable}
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
              unavailable={showAccountUnavailable}
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
    </>
  );
}
