"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./PublicHeader.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccountMenu } from "@/components/user/AccountMenu";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type {
  AccountPresenceResponse,
  AccountSummaryResponse,
} from "@/lib/account/summary";
import type { PublicHeaderUser } from "@/components/layout/PublicHeader";
import { ACTIVE_X_CHANGED_EVENT } from "@/lib/client/activeXSwitchEvents";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "./publicNavigation";

const PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS = 5_000;
const PUBLIC_ACCOUNT_RETRY_EVENT = "flamenode:public-account-presence-retry";
const PUBLIC_ACCOUNT_DETAILS_RETRY_EVENT =
  "flamenode:public-account-details-retry";

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
    },
    accountDetailsLoaded: true,
    ...(summary.degraded ? { degraded: true as const } : {}),
  };
}

function mapPresenceToHeaderUser(
  presence: Extract<AccountPresenceResponse, { loggedIn: true }>,
): PublicHeaderUser {
  return {
    id: "",
    name: presence.displayName,
    image: presence.icon,
    // Presence data is for display only. Privileged links stay hidden until
    // the full, current database-backed summary has been loaded.
    role: "user",
    xIds: [],
    management: {
      canAccessAdmin: false,
      canAccessManage: false,
    },
    accountDetailsLoaded: false,
  };
}

function requestPublicAccountRetry(): void {
  window.dispatchEvent(new Event(PUBLIC_ACCOUNT_RETRY_EVENT));
}

function requestPublicAccountDetailsRetry(): void {
  window.dispatchEvent(new Event(PUBLIC_ACCOUNT_DETAILS_RETRY_EVENT));
}

export function usePublicAccountSummary(
  enabled: boolean,
  loadDetails: boolean,
  preserveLoggedInOnFailure = false,
): {
  user: PublicHeaderUser | null;
  loading: boolean;
  unavailable: boolean;
  detailsReady: boolean;
  detailsLoading: boolean;
  detailsUnavailable: boolean;
  confirmedLoggedOut: boolean;
  retryDetails: () => void;
} {
  const [user, setUser] = React.useState<PublicHeaderUser | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [unavailable, setUnavailable] = React.useState(false);
  const [presenceLoaded, setPresenceLoaded] = React.useState(false);
  const [presenceRetryNonce, setPresenceRetryNonce] = React.useState(0);
  const [detailsRequested, setDetailsRequested] = React.useState(false);
  const [detailsReady, setDetailsReady] = React.useState(false);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [detailsUnavailable, setDetailsUnavailable] = React.useState(false);
  const [confirmedLoggedOut, setConfirmedLoggedOut] = React.useState(false);
  const presenceStartedRef = React.useRef(false);
  const detailsStartedRef = React.useRef(false);
  const presenceUserRef = React.useRef<PublicHeaderUser | null>(null);
  const mountedRef = React.useRef(false);
  const preserveLoggedInOnFailureRef = React.useRef(preserveLoggedInOnFailure);

  preserveLoggedInOnFailureRef.current = preserveLoggedInOnFailure;

  const invalidateDetails = React.useCallback(() => {
    detailsStartedRef.current = false;
    setDetailsReady(false);
    setDetailsUnavailable(false);
    setUser(presenceUserRef.current);
    setDetailsRequested(true);
  }, []);

  const retryDetails = React.useCallback(() => {
    if (presenceLoaded) {
      requestPublicAccountDetailsRetry();
    } else {
      requestPublicAccountRetry();
    }
  }, [presenceLoaded]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const requestPresenceRetry = () => {
      presenceStartedRef.current = false;
      setUnavailable(false);
      setPresenceRetryNonce((current) => current + 1);
    };
    const requestDetailsRetry = () => {
      invalidateDetails();
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, requestDetailsRetry);
    window.addEventListener(PUBLIC_ACCOUNT_RETRY_EVENT, requestPresenceRetry);
    window.addEventListener(
      PUBLIC_ACCOUNT_DETAILS_RETRY_EVENT,
      requestDetailsRetry,
    );
    return () => {
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, requestDetailsRetry);
      window.removeEventListener(
        PUBLIC_ACCOUNT_RETRY_EVENT,
        requestPresenceRetry,
      );
      window.removeEventListener(
        PUBLIC_ACCOUNT_DETAILS_RETRY_EVENT,
        requestDetailsRetry,
      );
    };
  }, [enabled, invalidateDetails]);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setUnavailable(false);
      setConfirmedLoggedOut(false);
      return;
    }
    if (presenceLoaded || presenceStartedRef.current) return;

    presenceStartedRef.current = true;
    setLoading(true);

    void (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch("/api/account/summary?view=presence", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 503 || !response.ok) {
          if (!mountedRef.current) return;
          setUnavailable(true);
          if (!preserveLoggedInOnFailureRef.current) {
            presenceUserRef.current = null;
            setUser(null);
          }
          return;
        }
        const presence = (await response.json()) as AccountPresenceResponse;
        if (!mountedRef.current) return;
        if (presence.loggedIn) {
          const nextUser = mapPresenceToHeaderUser(presence);
          presenceUserRef.current = nextUser;
          setUser(nextUser);
          setConfirmedLoggedOut(false);
          setDetailsReady(false);
          setDetailsUnavailable(false);
        } else if (presence.unavailable) {
          setUnavailable(true);
          if (!preserveLoggedInOnFailureRef.current) {
            presenceUserRef.current = null;
            setUser(null);
          }
          return;
        } else {
          presenceUserRef.current = null;
          setUser(null);
          setConfirmedLoggedOut(true);
          setDetailsReady(false);
          setDetailsUnavailable(false);
        }
        setPresenceLoaded(true);
        setUnavailable(false);
      } catch {
        if (!mountedRef.current) return;
        setUnavailable(true);
        if (!preserveLoggedInOnFailureRef.current) {
          presenceUserRef.current = null;
          setUser(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, [enabled, presenceLoaded, presenceRetryNonce, preserveLoggedInOnFailure]);

  React.useEffect(() => {
    if (!enabled || !loadDetails) return;
    setDetailsRequested(true);
  }, [enabled, loadDetails]);

  React.useEffect(() => {
    if (
      !enabled ||
      !detailsRequested ||
      !presenceLoaded ||
      !presenceUserRef.current ||
      detailsReady ||
      detailsUnavailable ||
      detailsStartedRef.current
    ) {
      return;
    }

    detailsStartedRef.current = true;
    setDetailsLoading(true);
    setUser(presenceUserRef.current);
    void (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch("/api/account/summary", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 503 || !response.ok) {
          if (mountedRef.current) setDetailsUnavailable(true);
          return;
        }
        const summary = (await response.json()) as AccountSummaryResponse;
        if (!mountedRef.current) return;
        if (summary.loggedIn) {
          setUser(mapSummaryToHeaderUser(summary));
          setDetailsReady(true);
          setDetailsUnavailable(false);
          setConfirmedLoggedOut(false);
        } else if (summary.unavailable) {
          setDetailsUnavailable(true);
        } else {
          presenceUserRef.current = null;
          setUser(null);
          setConfirmedLoggedOut(true);
          setDetailsReady(false);
          setDetailsUnavailable(false);
        }
      } catch {
        if (mountedRef.current) setDetailsUnavailable(true);
      } finally {
        window.clearTimeout(timeoutId);
        if (mountedRef.current) setDetailsLoading(false);
      }
    })();
  }, [
    detailsReady,
    detailsRequested,
    detailsUnavailable,
    enabled,
    loadDetails,
    presenceLoaded,
  ]);

  return {
    user,
    loading,
    unavailable,
    detailsReady,
    detailsLoading,
    detailsUnavailable,
    confirmedLoggedOut,
    retryDetails,
  };
}

type PublicAccountIslandProps = {
  user: PublicHeaderUser | null;
  loading: boolean;
  unavailable: boolean;
  detailsReady: boolean;
  detailsLoading: boolean;
  detailsUnavailable: boolean;
  onRetryDetails: () => void;
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
  unavailable,
  detailsReady,
  detailsLoading,
  detailsUnavailable,
  onRetryDetails,
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
          role="status"
          aria-label="ログイン状態を確認中"
        >
          <Icon name="user" size={18} aria-hidden />
        </div>
      );
    }

    if (unavailable) {
      return (
        <button
          type="button"
          className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.accountUnavailable}`}
          onClick={requestPublicAccountRetry}
          title="ログイン状態をもう一度確認します"
        >
          ログイン状態を再確認
        </button>
      );
    }

    if (user) {
      return (
        <>
          <Link
            href="/entry"
            className={`fn-btn fn-header-submit ${styles.headerCta} ${styles.postBtn}`}
            data-variant="accent"
            prefetch={false}
          >
            <Icon name="edit" size={13} aria-hidden />
            <span>投稿する</span>
          </Link>
          <div className={styles.actionNav}>
            <AccountMenu
              user={user}
              detailsReady={detailsReady}
              detailsLoading={detailsLoading}
              detailsUnavailable={detailsUnavailable}
              onRetryDetails={onRetryDetails}
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
        prefetch={false}
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

    if (unavailable) {
      return (
        <button
          type="button"
          className={`${styles.mobileLink} ${styles.mobileAccountUnavailable}`}
          onClick={requestPublicAccountRetry}
        >
          ログイン状態を再確認
        </button>
      );
    }

    if (user) {
      return (
        <Link
          href="/entry"
          className={`${styles.mobileLink} ${styles.mobileLinkAccent}`}
          onClick={onClosePanels}
          prefetch={false}
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
        prefetch={false}
      >
        <Icon name="edit" size={16} aria-hidden /> 参加する
      </Link>
    );
  }

  if (loading) {
    return (
      <div className={styles.mobileSection} aria-busy="true">
        {PUBLIC_NAV_ITEMS.map((item) => {
          const active = isPublicNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileLink} ${
                active ? styles.mobileLinkActive : ""
              }`}
              onClick={onClosePanels}
              aria-current={active ? "page" : undefined}
              prefetch={false}
            >
              <Icon name={item.iconName} size={16} aria-hidden /> {item.label}
            </Link>
          );
        })}
      </div>
    );
  }

  if (unavailable || !user) {
    return (
      <div className={styles.mobileSection}>
        {PUBLIC_NAV_ITEMS.map((item) => {
          const active = isPublicNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileLink} ${
                active ? styles.mobileLinkActive : ""
              }`}
              onClick={onClosePanels}
              aria-current={active ? "page" : undefined}
              prefetch={false}
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
            {!detailsReady
              ? detailsUnavailable
                ? "アカウント詳細を取得できません"
                : "アカウント詳細を確認中"
              : activeEntry
                ? `@${activeEntry.x_user_id}`
                : "Active X ID未選択"}
          </span>
          <small>
            {detailsReady ? "現在の投稿・コメントの活動名義" : ""}
          </small>
        </div>
      </div>

      {!detailsReady ? (
        <div className={styles.mobileSection} role="status" aria-busy={detailsLoading}>
          {detailsUnavailable ? (
            <button
              type="button"
              className={styles.mobileLink}
              onClick={onRetryDetails}
            >
              アカウント情報を再確認
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.mobileIdentityControls}>
        <ThemeToggle variant="segmented" />
      </div>

      <div className={styles.mobileSection}>
        {PUBLIC_NAV_ITEMS.map((item) => {
          const active = isPublicNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileLink} ${
                active ? styles.mobileLinkActive : ""
              }`}
              onClick={onClosePanels}
              aria-current={active ? "page" : undefined}
              prefetch={false}
            >
              <Icon name={item.iconName} size={16} aria-hidden /> {item.label}
            </Link>
          );
        })}
        <Link
          href="/dashboard"
          className={styles.mobileLink}
          onClick={onClosePanels}
          prefetch={false}
        >
          <Icon name="grid" size={16} aria-hidden /> マイページ
        </Link>
        <Link
          href="/dashboard/library"
          className={styles.mobileLink}
          onClick={onClosePanels}
          prefetch={false}
        >
          <Icon name="bookmark" size={16} aria-hidden /> ライブラリ
        </Link>
        <Link
          href="/dashboard/settings"
          className={styles.mobileLink}
          onClick={onClosePanels}
          prefetch={false}
        >
          <Icon name="settings" size={16} aria-hidden /> 設定
        </Link>
      </div>

      {detailsReady &&
      (user.management.canAccessAdmin || user.management.canAccessManage) ? (
        <>
          <div className={styles.mobileDivider} />
          <div className={styles.mobileSection}>
            {user.management.canAccessManage ? (
              <Link
                href="/manage"
                className={styles.mobileLink}
                onClick={onClosePanels}
                prefetch={false}
              >
                <Icon name="users" size={16} aria-hidden /> 運営
              </Link>
            ) : null}
            {user.management.canAccessAdmin ? (
              <Link
                href="/admin"
                className={styles.mobileLink}
                onClick={onClosePanels}
                prefetch={false}
              >
                <Icon name="settings" size={16} aria-hidden /> 管理
              </Link>
            ) : null}
          </div>
        </>
      ) : null}

      <div className={styles.mobileDivider} />
      <div className={styles.mobileSection}>
        <SignOutButton
          className={`${styles.mobileLink} ${styles.mobileLinkDanger}`}
        >
          <Icon name="logout" size={16} aria-hidden /> ログアウト
        </SignOutButton>
      </div>
    </>
  );
}
