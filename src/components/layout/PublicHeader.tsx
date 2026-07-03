"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";
import { AccountMenu } from "@/components/user/AccountMenu";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { PUBLIC_NAV_ITEMS } from "@/lib/navigation/publicNav";
import { navigateGetForm } from "@/components/forms/AutoSubmitSelect";
import { sanitizeNextPath } from "#utils/next";

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
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);
  const desktopSearchRef = React.useRef<HTMLInputElement>(null);
  const mobileSearchRef = React.useRef<HTMLInputElement>(null);
  const mobileSearchPanelRef = React.useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const entryNext = sanitizeNextPath(pathname ?? "/", "/");
  const entryHref =
    entryNext === "/entry"
      ? "/entry"
      : `/entry?next=${encodeURIComponent(entryNext)}`;

  const managementNav = user
    ? [
        ...(user.management.canAccessManage
          ? [{ href: "/manage", label: "イベント運営", icon: "users" as const }]
          : []),
        ...(user.management.canAccessAdmin
          ? [{ href: "/admin", label: "サイト管理", icon: "settings" as const }]
          : []),
      ]
    : [];

  React.useEffect(() => {
    if (!mobileSearchOpen) return;
    mobileSearchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSearchOpen]);

  const closeMobilePanels = () => {
    setMobileOpen(false);
    setMobileSearchOpen(false);
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

        <nav className={`fn-nav ${styles.desktopNav}`} aria-label="公開ナビゲーション">
          {PUBLIC_NAV_ITEMS.map((item) => {
            const active = isPathActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`fn-nav-item fn-nav-ja ${styles.desktopNavLink} ${
                  active ? `${styles.desktopNavLinkActive} is-active` : ""
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={`fn-header-right ${styles.right}`}>
          <div className={styles.themeButton}>
            <ThemeToggle />
          </div>

          <form
            action="/list"
            method="get"
            className={styles.searchForm}
            role="search"
            aria-label="作品検索"
            onSubmit={(e) => {
              e.preventDefault();
              navigateGetForm(e.currentTarget);
            }}
          >
            <span className={styles.searchIcon}>
              <Icon name="search" size={14} aria-hidden />
            </span>
            <label htmlFor="header-search" className="fn-sr-only">
              作品を検索
            </label>
            <input
              id="header-search"
              ref={desktopSearchRef}
              type="search"
              name="q"
              placeholder="作品を検索"
              autoComplete="off"
            />
          </form>

          <button
            type="button"
            className={styles.mobileSearchToggle}
            aria-label="作品を検索"
            aria-expanded={mobileSearchOpen}
            aria-controls="header-mobile-search"
            onClick={() => {
              setMobileSearchOpen((open) => !open);
              setMobileOpen(false);
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
              <div className={styles.actionNav}>
                {managementNav.map((item) => (
                  <Link key={item.href} href={item.href} className={styles.ghostBtn}>
                    <Icon name={item.icon} size={13} aria-hidden />
                    {item.label}
                  </Link>
                ))}
                <AccountMenu user={user} />
              </div>
            </>
          ) : (
            <Link
              href={entryHref}
              className={`fn-btn fn-header-submit ${styles.headerCta} ${styles.joinBtn}`}
              data-variant="accent"
            >
              <Icon name="edit" size={13} aria-hidden />
              <span>参加・投稿する</span>
            </Link>
          )}

          <button
            type="button"
            className={styles.menuToggle}
            aria-label="メニューを開く"
            aria-expanded={mobileOpen}
            onClick={() => {
              setMobileOpen((open) => !open);
              setMobileSearchOpen(false);
            }}
          >
            <Icon name={mobileOpen ? "close" : "menu"} size={18} />
          </button>
        </div>
      </div>

      <div
        id="header-mobile-search"
        ref={mobileSearchPanelRef}
        className={`${styles.mobileSearchPanel} ${
          mobileSearchOpen ? styles.mobileSearchPanelOpen : ""
        }`}
        hidden={!mobileSearchOpen}
      >
        <form
          action="/list"
          method="get"
          className={`fn-public-container ${styles.mobileSearchPanelForm}`}
          role="search"
          aria-label="作品検索"
          onSubmit={(e) => {
            e.preventDefault();
            navigateGetForm(e.currentTarget);
            setMobileSearchOpen(false);
          }}
        >
          <label htmlFor="header-mobile-search-input" className="fn-sr-only">
            作品を検索
          </label>
          <input
            id="header-mobile-search-input"
            ref={mobileSearchRef}
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
            className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.mobileSearchClose}`}
            aria-label="検索を閉じる"
            onClick={() => setMobileSearchOpen(false)}
          >
            <Icon name="close" size={14} aria-hidden />
          </button>
        </form>
      </div>

      <div className={`${styles.mobile} ${mobileOpen ? styles.mobileOpen : ""}`}>
        <nav
          className={`fn-public-container ${styles.mobileNav}`}
          aria-label="モバイルナビゲーション"
          aria-hidden={!mobileOpen}
        >
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

              {managementNav.length > 0 ? (
                <>
                  <div className={styles.mobileDivider} />
                  <div className={styles.mobileSection}>
                    {managementNav.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={styles.mobileLink}
                        onClick={closeMobilePanels}
                      >
                        <Icon name={item.icon} size={16} aria-hidden /> {item.label}
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}

              <div className={styles.mobileDivider} />
              <div className={styles.mobileSection}>
                <div className={styles.mobileSectionTitle}>X ID切替</div>
                <div className={styles.mobileXIdContainer}>
                  <XIdSwitcher entries={user.xIds} discordName={user.name} />
                </div>
              </div>

              <div className={styles.mobileDivider} />
              <div className={styles.mobileSection}>
                <div className={styles.mobileSectionTitle}>テーマ</div>
                <div className={styles.themeSlot}>
                  <ThemeToggle />
                </div>
              </div>

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
