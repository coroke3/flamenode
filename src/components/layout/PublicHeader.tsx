"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./PublicHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";

export interface PublicHeaderUser {
  id: string;
  name: string;
  image: string | null;
  xIds: XIdEntry[];
}

interface PublicHeaderProps {
  user: PublicHeaderUser | null;
}

// 上部バーの常時ナビは最小化。作品一覧・イベント・クリエイター・おすすめ・ABOUTは除去。
// 各ページは /list /event /recommend /about として存続するが、ナビには表示しない。

export function PublicHeader({ user }: PublicHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.logoLink} aria-label="FlameNode トップへ">
          <Logo />
        </Link>

        <div className={styles.right}>
          <form
            action="/list"
            method="get"
            className={styles.searchForm}
            role="search"
            aria-label="サイト内検索"
          >
            <Icon name="search" size={13} aria-hidden />
            <label htmlFor="header-search" className="fn-sr-only">
              検索
            </label>
            <input
              id="header-search"
              type="search"
              name="q"
              placeholder="作品・作者・イベント"
              autoComplete="off"
            />
          </form>
          <ThemeToggle />
          {user ? (
            <>
              <Link href="/dashboard" className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.dashLink}`}>
                <Icon name="user" size={13} aria-hidden />
                ダッシュボード
              </Link>
              <XIdSwitcher entries={user.xIds} discordName={user.name} />
            </>
          ) : (
            <Link href="/entry" className="fn-btn fn-btn-primary fn-btn-sm">
              <Icon name="discord" size={13} aria-hidden />
              ログイン
            </Link>
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
          <nav className={styles.mobileNav} aria-label="モバイルナビゲーション">
            {!user ? (
              <Link
                href="/entry"
                className={`fn-btn fn-btn-primary ${styles.mobileCta}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name="discord" size={14} aria-hidden />
                Discord でログイン
              </Link>
            ) : (
              <Link
                href="/dashboard"
                className={`fn-btn fn-btn-ghost ${styles.mobileCta}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name="user" size={14} aria-hidden />
                ダッシュボード
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
