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
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const loginNext = sanitizeNextPath(pathname ?? "/", "/");
  const loginHref = `/entry?next=${encodeURIComponent(loginNext)}`;

  const managementNav = user
    ? [
        ...(user.management.canAccessManage
          ? [{ href: "/manage", label: "運営", icon: "users" as const }]
          : []),
        ...(user.management.canAccessAdmin
          ? [{ href: "/admin", label: "管理", icon: "settings" as const }]
          : []),
      ]
    : [];

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
            onClick={() => searchInputRef.current?.focus()}
          >
            <span className={styles.searchIcon}>
              <Icon name="search" size={14} aria-hidden />
            </span>
            <label htmlFor="header-search" className="fn-sr-only">
              検索
            </label>
            <input
              id="header-search"
              ref={searchInputRef}
              type="search"
              name="q"
              placeholder="作品を検索"
              autoComplete="off"
            />
          </form>

          {user ? (
            <div className={styles.actionNav}>
              <Link
                href="/dashboard/post"
                className={`fn-btn fn-header-submit ${styles.postBtn}`}
                data-variant="accent"
              >
                <Icon name="edit" size={13} aria-hidden />
                投稿する
              </Link>
              {managementNav.map((item) => (
                <Link key={item.href} href={item.href} className={styles.ghostBtn}>
                  <Icon name={item.icon} size={13} aria-hidden />
                  {item.label}
                </Link>
              ))}
              <AccountMenu user={user} />
            </div>
          ) : (
            <div className={styles.actionNav}>
              <Link href="/entry" className={styles.loginBtn}>
                ログイン
              </Link>
            </div>
          )}

          <button
            type="button"
            className={styles.menuToggle}
            aria-label="メニューを開く"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <Icon name={mobileOpen ? "close" : "menu"} size={18} />
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className={styles.mobile}>
          <nav
            className={`fn-public-container ${styles.mobileNav}`}
            aria-label="モバイルナビゲーション"
          >
            <form
              action="/list"
              method="get"
              className={styles.mobileSearch}
              role="search"
              aria-label="作品検索"
            >
              <Icon name="search" size={14} aria-hidden />
              <input
                type="search"
                name="q"
                placeholder="作品を検索"
                autoComplete="off"
              />
            </form>

            {!user ? (
              <div className={styles.mobileSection}>
                <Link
                  href={loginHref}
                  className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon name="discord" size={16} aria-hidden /> Discord でログイン
                </Link>
                {PUBLIC_NAV_ITEMS.map((item) => {
                  const active = isPathActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.mobileLink} ${
                        active ? styles.mobileLinkActive : ""
                      }`}
                      onClick={() => setMobileOpen(false)}
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
                  <Link
                    href="/dashboard/post"
                    className={styles.mobileLink}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon name="edit" size={16} aria-hidden /> 投稿する
                  </Link>
                  <Link
                    href="/dashboard"
                    className={styles.mobileLink}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon name="grid" size={16} aria-hidden /> マイページ
                  </Link>
                  <Link
                    href="/dashboard/library"
                    className={styles.mobileLink}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon name="bookmark" size={16} aria-hidden /> ライブラリ
                  </Link>
                  <Link
                    href="/dashboard/settings"
                    className={styles.mobileLink}
                    onClick={() => setMobileOpen(false)}
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
                          onClick={() => setMobileOpen(false)}
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
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon name="logout" size={16} aria-hidden /> ログアウト
                  </Link>
                </div>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
