"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher } from "@/components/user/XIdSwitcher";
import type { XIdEntry } from "@/lib/xid/entries";
import { AccountMenu } from "@/components/user/AccountMenu";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { PUBLIC_NAV_ITEMS } from "@/lib/navigation/publicNav";
import { navigateGetForm } from "@/components/forms/AutoSubmitSelect";
import { sanitizeNextPath } from "#utils/next";
import { useDismissablePanel } from "./useDismissablePanel";

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
  user: PublicHeaderUser | null;
}

export function PublicHeader({ user }: PublicHeaderProps): React.ReactElement {
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

        <div className={`fn-header-right ${styles.right}`}>
          <div className={`${styles.themeButton}`}>
            <ThemeToggle />
          </div>

          {user ? (
            <div className={`${styles.desktopXId}`}>
              <XIdSwitcher entries={user.xIds} discordName={user.name} />
            </div>
          ) : null}

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

          {user ? (
            <>
              <Link
                href="/entry"
                className={`fn-btn fn-header-submit ${styles.headerCta} ${styles.postBtn}`}
                data-variant="accent"
              >
                <Icon name="edit" size={13} aria-hidden />
                <span>投稿する</span>
              </Link>
              <div className={`${styles.actionNav}`}>
                <AccountMenu
                  user={user}
                  open={accountOpen}
                  onOpenChange={(open) => {
                    setAccountOpen(open);

                    if (open) {
                      setMobileOpen(false);
                      setSearchOpen(false);
                    }
                  }}
                />
              </div>
            </>
          ) : (
            <Link
              href={entryHref}
              className={`fn-btn fn-header-submit ${styles.headerCta} ${styles.joinBtn}`}
              data-variant="accent"
            >
              <Icon name="edit" size={13} aria-hidden />
              <span>参加する</span>
            </Link>
          )}

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
            {user ? (
              <Link
                href="/entry"
                className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
                onClick={closeMobilePanels}
              >
                <Icon name="edit" size={16} aria-hidden /> 投稿する
              </Link>
            ) : (
              <Link
                href={entryHref}
                className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
                onClick={closeMobilePanels}
              >
                <Icon name="edit" size={16} aria-hidden /> 参加する
              </Link>
            )}
          </div>

          <div className={styles.mobileDivider} />

          {!user ? (
            <div className={styles.mobileSection}>
              {PUBLIC_NAV_ITEMS.map((item) => {
                const active = isPathActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.mobileLink} ${
                      active ? styles.mobileLinkActive : ""
                    }`}
                    onClick={closeMobilePanels}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon name={item.iconName} size={16} aria-hidden /> {item.label}
                  </Link>
                );
              })}
              <div className={styles.mobileThemeRow}>
                <span>テーマ</span>
                <ThemeToggle />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.mobileUserHeader}>
                {user.image ? (
                  <img
                    src={user.image}
                    alt=""
                    className={styles.mobileUserAvatar}
                  />
                ) : (
                  <span
                    className={
                      styles.mobileUserAvatarFallback
                    }
                  >
                    <Icon
                      name="user"
                      size={20}
                      aria-hidden
                    />
                  </span>
                )}

                <div>
                  <strong>{user.name}</strong>
                  <span>
                    {user.xIds.find(
                      (entry) => entry.is_active,
                    )
                      ? `@${
                          user.xIds.find(
                            (entry) => entry.is_active,
                          )!.x_user_id
                        }`
                      : "Active X ID未選択"}
                  </span>
                  <small>
                    現在の投稿・いいね・コメント主体
                  </small>
                </div>
              </div>

              <div className={styles.mobileIdentityControls}>
                <XIdSwitcher
                  entries={user.xIds}
                  discordName={user.name}
                />
                <ThemeToggle variant="segmented" />
              </div>

              <div className={styles.mobileSection}>
                {PUBLIC_NAV_ITEMS.map((item) => {
                  const active = isPathActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.mobileLink} ${
                        active ? styles.mobileLinkActive : ""
                      }`}
                      onClick={closeMobilePanels}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon name={item.iconName} size={16} aria-hidden /> {item.label}
                    </Link>
                  );
                })}
                <Link
                  href="/dashboard"
                  className={styles.mobileLink}
                  onClick={closeMobilePanels}
                >
                  <Icon name="grid" size={16} aria-hidden /> マイページ
                </Link>
                <Link
                  href="/dashboard/library"
                  className={styles.mobileLink}
                  onClick={closeMobilePanels}
                >
                  <Icon name="bookmark" size={16} aria-hidden /> ライブラリ
                </Link>
                <Link
                  href="/dashboard/settings"
                  className={styles.mobileLink}
                  onClick={closeMobilePanels}
                >
                  <Icon name="settings" size={16} aria-hidden /> 設定
                </Link>
              </div>

              {user.management.canAccessAdmin ||
              user.management.canAccessManage ? (
                <>
                  <div className={styles.mobileDivider} />
                  <div className={styles.mobileSection}>
                    {user.management.canAccessManage ? (
                      <Link
                        href="/manage"
                        className={styles.mobileLink}
                        onClick={closeMobilePanels}
                      >
                        <Icon name="users" size={16} aria-hidden /> 運営
                      </Link>
                    ) : null}
                    {user.management.canAccessAdmin ? (
                      <Link
                        href="/admin"
                        className={styles.mobileLink}
                        onClick={closeMobilePanels}
                      >
                        <Icon name="settings" size={16} aria-hidden /> 管理
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div className={styles.mobileDivider} />
              <div className={styles.mobileSection}>
                <Link
                  href="/api/auth/signout"
                  className={`${styles.mobileLink} ${styles.mobileLinkDanger}`}
                  onClick={closeMobilePanels}
                >
                  <Icon name="logout" size={16} aria-hidden /> ログアウト
                </Link>
              </div>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
