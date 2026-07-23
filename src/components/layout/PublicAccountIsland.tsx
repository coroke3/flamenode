"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./PublicHeader.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccountMenu } from "@/components/user/AccountMenu";
import type { AccountSummaryResponse } from "@/lib/account/summary";
import type { PublicHeaderUser } from "@/components/layout/PublicHeader";

const MOBILE_NAV_ITEMS = [
  { href: "/list", label: "動画", iconName: "grid" as const },
  { href: "/user", label: "クリエイター", iconName: "users" as const },
  { href: "/event", label: "イベント", iconName: "calendar" as const },
];

function mapSummaryToHeaderUser(
  summary: Extract<AccountSummaryResponse, { loggedIn: true }>,
): PublicHeaderUser & { degraded?: true } {
  return {
    id: "",
    name: summary.displayName,
    image: summary.icon,
    role: summary.role,
    xIds: summary.xIds,
    management: {
      canAccessAdmin: summary.canAccessAdmin,
      canAccessManage: summary.canAccessManage,
      manageableEventCount: 0,
    },
    ...(summary.degraded ? { degraded: true as const } : {}),
  };
}

export function usePublicAccountSummary(
  enabled: boolean,
  preserveLoggedInOnFailure = false,
): {
  user: PublicHeaderUser | null;
  loading: boolean;
} {
  const [user, setUser] = React.useState<PublicHeaderUser | null>(null);
  const [loading, setLoading] = React.useState(enabled);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch("/api/account/summary", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled && !preserveLoggedInOnFailure) setUser(null);
          return;
        }
        const summary = (await response.json()) as AccountSummaryResponse;
        if (!cancelled) {
          if (summary.loggedIn) {
            setUser(mapSummaryToHeaderUser(summary));
          } else if (!preserveLoggedInOnFailure) {
            setUser(null);
          }
        }
      } catch {
        if (!cancelled && !preserveLoggedInOnFailure) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, preserveLoggedInOnFailure]);

  return { user, loading };
}

type PublicAccountIslandProps = {
  user: PublicHeaderUser | null;
  loading: boolean;
  entryHref: string;
  accountOpen: boolean;
  onAccountOpenChange: (open: boolean) => void;
  onClosePanels: () => void;
  pathname: string | null;
  variant: "desktop" | "mobile-cta" | "mobile-nav";
};

export function PublicAccountIsland({
  user,
  loading,
  entryHref,
  accountOpen,
  onAccountOpenChange,
  onClosePanels,
  pathname,
  variant,
}: PublicAccountIslandProps): React.ReactElement | null {
  if (variant === "desktop") {
    if (loading) {
      return (
        <div
          className={`${styles.actionNav} ${styles.accountPlaceholder}`}
          aria-hidden
        />
      );
    }

    if (user) {
      return (
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
            <AccountMenu
              user={user}
              open={accountOpen}
              onOpenChange={onAccountOpenChange}
            />
          </div>
        </>
      );
    }

    return (
      <Link
        href={entryHref}
        className={`fn-btn fn-header-submit ${styles.headerCta} ${styles.joinBtn}`}
        data-variant="accent"
      >
        <Icon name="edit" size={13} aria-hidden />
        <span>参加する</span>
      </Link>
    );
  }

  if (variant === "mobile-cta") {
    if (loading) {
      return (
        <span
          className={`${styles.mobileLink} ${styles.mobileLinkAccent} ${styles.accountPlaceholder}`}
          aria-hidden
        />
      );
    }

    if (user) {
      return (
        <Link
          href="/entry"
          className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
          onClick={onClosePanels}
        >
          <Icon name="edit" size={16} aria-hidden /> 投稿する
        </Link>
      );
    }

    return (
      <Link
        href={entryHref}
        className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
        onClick={onClosePanels}
      >
        <Icon name="edit" size={16} aria-hidden /> 参加する
      </Link>
    );
  }

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <div className={styles.mobileSection}>
        {MOBILE_NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileLink} ${
                active ? styles.mobileLinkActive : ""
              }`}
              onClick={onClosePanels}
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
    );
  }

  const activeEntry = user.xIds.find((entry) => entry.is_active);

  return (
    <>
      <div className={styles.mobileUserHeader}>
        {user.image ? (
          <img src={user.image} alt="" className={styles.mobileUserAvatar} />
        ) : (
          <span className={styles.mobileUserAvatarFallback}>
            <Icon name="user" size={20} aria-hidden />
          </span>
        )}

        <div>
          <strong>{user.name}</strong>
          <span>
            {activeEntry
              ? `@${activeEntry.x_user_id}`
              : "Active X ID未選択"}
          </span>
          <small>現在の投稿・いいね・コメント主体</small>
        </div>
      </div>

      <div className={styles.mobileIdentityControls}>
        <ThemeToggle variant="segmented" />
      </div>

      <div className={styles.mobileSection}>
        {MOBILE_NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileLink} ${
                active ? styles.mobileLinkActive : ""
              }`}
              onClick={onClosePanels}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.iconName} size={16} aria-hidden /> {item.label}
            </Link>
          );
        })}
        <Link
          href="/dashboard"
          className={styles.mobileLink}
          onClick={onClosePanels}
        >
          <Icon name="grid" size={16} aria-hidden /> マイページ
        </Link>
        <Link
          href="/dashboard/library"
          className={styles.mobileLink}
          onClick={onClosePanels}
        >
          <Icon name="bookmark" size={16} aria-hidden /> ライブラリ
        </Link>
        <Link
          href="/dashboard/settings"
          className={styles.mobileLink}
          onClick={onClosePanels}
        >
          <Icon name="settings" size={16} aria-hidden /> 設定
        </Link>
      </div>

      {user.management.canAccessAdmin || user.management.canAccessManage ? (
        <>
          <div className={styles.mobileDivider} />
          <div className={styles.mobileSection}>
            {user.management.canAccessManage ? (
              <Link
                href="/manage"
                className={styles.mobileLink}
                onClick={onClosePanels}
              >
                <Icon name="users" size={16} aria-hidden /> 運営
              </Link>
            ) : null}
            {user.management.canAccessAdmin ? (
              <Link
                href="/admin"
                className={styles.mobileLink}
                onClick={onClosePanels}
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
          onClick={onClosePanels}
        >
          <Icon name="logout" size={16} aria-hidden /> ログアウト
        </Link>
      </div>
    </>
  );
}
