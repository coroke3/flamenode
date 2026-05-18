"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./AuthHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";
import { AccountMenu } from "@/components/user/AccountMenu";
import type { HeaderUser } from "@/lib/auth/headerUser";

interface AuthHeaderProps {
  user: Pick<
    HeaderUser,
    "id" | "name" | "image" | "role" | "management"
  > & {
    xIds: XIdEntry[];
  };
}

export function AuthHeader({ user }: AuthHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const managementLink = user.management.canAccessAdmin
    ? { href: "/admin", label: "管理", icon: "settings" as const }
    : user.management.canAccessManage
      ? { href: "/manage", label: "運営", icon: "users" as const }
      : null;

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link
          href="/"
          className={styles.logoLink}
          aria-label="FlameNode トップへ"
        >
          <Logo />
        </Link>

        <div className={styles.right}>
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
            <Link href="/dashboard/post" className={styles.postBtn}>
              <Icon name="edit" size={13} aria-hidden />
              投稿
            </Link>
            {managementLink ? (
              <Link href={managementLink.href} className={styles.ghostBtn}>
                <Icon name={managementLink.icon} size={13} aria-hidden />
                {managementLink.label}
              </Link>
            ) : null}
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
          <nav className={styles.mobileNav} aria-label="モバイルナビゲーション">
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

            {managementLink ? (
              <>
                <div className={styles.mobileDivider} />
                <div className={styles.mobileSection}>
                  <Link
                    href={managementLink.href}
                    className={styles.mobileLink}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon name={managementLink.icon} size={16} aria-hidden />{" "}
                    {managementLink.label}
                  </Link>
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
