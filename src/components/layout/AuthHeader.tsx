"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AuthHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";
import { AccountMenu } from "@/components/user/AccountMenu";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { PUBLIC_NAV_ITEMS } from "@/lib/navigation/publicNav";

interface AuthHeaderProps {
  user: Pick<
    HeaderUser,
    "id" | "name" | "image" | "role" | "management"
  > & {
    xIds: XIdEntry[];
  };
}

type ManagementNavItem = {
  href: string;
  label: string;
  icon: IconName;
};

function buildManagementNav(
  management: HeaderUser["management"],
): ManagementNavItem[] {
  const items: ManagementNavItem[] = [];
  if (management.canAccessManage) {
    items.push({ href: "/manage", label: "運営", icon: "users" });
  }
  if (management.canAccessAdmin) {
    items.push({ href: "/admin", label: "管理", icon: "settings" });
  }
  return items;
}

function isPathActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AuthHeader({ user }: AuthHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const managementNav = buildManagementNav(user.management);

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

        <nav className={styles.desktopNav} aria-label="公開ナビゲーション">
          {PUBLIC_NAV_ITEMS.map((item) => {
            const active = isPathActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.desktopNavLink} ${
                  active ? styles.desktopNavLinkActive : ""
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={`fn-header-right ${styles.right}`}>
          <form
            action="/list"
            method="get"
            className={styles.searchForm}
            role="search"
            aria-label="サイト内検索"
            onClick={() => searchInputRef.current?.focus()}
          >
            <span className={styles.searchIcon}>
              <Icon name="search" size={14} aria-hidden />
            </span>
            <label htmlFor="auth-header-search" className="fn-sr-only">
              検索
            </label>
            <input
              id="auth-header-search"
              ref={searchInputRef}
              type="search"
              name="q"
              placeholder="作品を検索"
              autoComplete="off"
            />
          </form>

          <div className={styles.actionNav}>
            <Link href="/dashboard/post" className={`fn-btn fn-header-submit ${styles.postBtn}`}>
              <Icon name="edit" size={13} aria-hidden />
              投稿
            </Link>
            {managementNav.map((item) => (
              <Link key={item.href} href={item.href} className={styles.ghostBtn}>
                <Icon name={item.icon} size={13} aria-hidden />
                {item.label}
              </Link>
            ))}
            <AccountMenu user={user} />
          </div>

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
          <nav className={`fn-public-container ${styles.mobileNav}`} aria-label="モバイルナビゲーション">
            <form
              action="/list"
              method="get"
              className={styles.mobileSearch}
              role="search"
              aria-label="サイト内検索"
            >
              <Icon name="search" size={14} aria-hidden />
              <input
                type="search"
                name="q"
                placeholder="作品を検索"
                autoComplete="off"
              />
            </form>

            <div className={styles.mobileSection}>
              <div className={styles.mobileSectionTitle}>公開ページ</div>
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
            </div>

            <div className={styles.mobileDivider} />
            <div className={styles.mobileSection}>
              <div className={styles.mobileSectionTitle}>マイページ</div>
              <Link
                href="/dashboard/post"
                className={styles.mobileLink}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name="edit" size={16} aria-hidden /> 新規投稿
              </Link>
              <Link
                href="/dashboard"
                className={styles.mobileLink}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name="grid" size={16} aria-hidden /> ダッシュボード
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
              <div style={{ padding: "0 12px" }}>
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
          </nav>
        </div>
      ) : null}
    </header>
  );
}
