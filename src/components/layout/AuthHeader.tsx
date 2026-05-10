import * as React from "react";
import Link from "next/link";
import styles from "./AuthHeader.module.css";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { XIdSwitcher, type XIdEntry } from "@/components/user/XIdSwitcher";

interface AuthHeaderProps {
  user: {
    id: string;
    name: string;
    image: string | null;
    xIds: XIdEntry[];
  };
}

export function AuthHeader({ user }: AuthHeaderProps): React.ReactElement {
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
          <Link href="/entry">
            <Icon name="calendar" size={13} aria-hidden />
            エントリー
          </Link>
          <Link href="/dashboard/settings">
            <Icon name="settings" size={13} aria-hidden />
            設定
          </Link>
        </nav>
        <div className={styles.right}>
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
