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

const NAV_ITEMS = [
  { href: "/", primary: "TOP", sub: "トップ" },
  { href: "/list", primary: "LIST", sub: "作品一覧" },
  { href: "/user", primary: "CREATOR", sub: "クリエイター" },
  { href: "/event", primary: "EVENT", sub: "イベント" },
  { href: "/recommend", primary: "PICK", sub: "おすすめ" },
  { href: "/search", primary: "SEARCH", sub: "検索" },
];

export function PublicHeader({ user }: PublicHeaderProps): React.ReactElement {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.logoLink} aria-label="FlameNode トップへ">
          <Logo />
        </Link>

        <nav className={styles.nav} aria-label="グローバルナビゲーション">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              <span className={styles.navLinkPrimary}>{item.primary}</span>
              <span className={styles.navLinkSub}>{item.sub}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.right}>
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
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles.mobileItem}
                onClick={() => setMobileOpen(false)}
              >
                <span className={styles.mobileItemPrimary}>{item.primary}</span>
                <span className={styles.mobileItemSub}>{item.sub}</span>
              </Link>
            ))}
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
