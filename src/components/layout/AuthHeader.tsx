import * as React from "react";
import Link from "next/link";
import styles from "./AuthHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";
import type { HeaderUser } from "@/lib/auth/headerUser";

interface AuthHeaderProps {
  user: Pick<HeaderUser, "id" | "name" | "image" | "role" | "management"> & {
    xIds: XIdEntry[];
  };
}

export function AuthHeader({ user }: AuthHeaderProps): React.ReactElement {
  const managementLink = user.management.canAccessAdmin
    ? { href: "/admin", label: "管理", icon: "settings" as const }
    : user.management.canAccessManage
      ? { href: "/manage", label: "運営", icon: "users" as const }
      : null;

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <div className={styles.left}>
          <Link href="/" aria-label="FlameNode トップへ">
            <Logo />
          </Link>
        </div>
        <nav className={styles.nav} aria-label="認証エリアナビゲーション">
          <Link href="/dashboard">
            <Icon name="grid" size={13} aria-hidden />
            ダッシュボード
          </Link>
          <Link href="/dashboard/post">
            <Icon name="edit" size={13} aria-hidden />
            投稿
          </Link>
          {managementLink ? (
            <Link href={managementLink.href}>
              <Icon name={managementLink.icon} size={13} aria-hidden />
              {managementLink.label}
            </Link>
          ) : null}
          <Link href="/entry">
            <Icon name="calendar" size={13} aria-hidden />
            エントリー
          </Link>
          <Link href="/dashboard/library">
            <Icon name="bookmark" size={13} aria-hidden />
            ライブラリ
          </Link>
          <Link href="/dashboard/settings">
            <Icon name="settings" size={13} aria-hidden />
            設定
          </Link>
        </nav>
        <div className={styles.right}>
          <form
            action="/list"
            method="get"
            role="search"
            aria-label="サイト内検索"
            className={styles.searchForm}
          >
            <Icon name="search" size={13} aria-hidden />
            <input
              type="search"
              name="q"
              placeholder="検索"
              autoComplete="off"
            />
          </form>
          <ThemeToggle />
          <span className={styles.divider} />
          <XIdSwitcher entries={user.xIds} discordName={user.name} />
          <Link
            href="/api/auth/signout"
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="logout" size={13} aria-hidden />
            <span className="fn-sr-only">ログアウト</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
