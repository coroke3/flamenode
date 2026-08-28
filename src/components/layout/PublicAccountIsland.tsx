"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./PublicHeader.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccountMenu } from "@/components/user/AccountMenu";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { AccountSummaryResponse } from "@/lib/account/summary";
import type { PublicHeaderUser } from "@/components/layout/PublicHeader";
import { ACTIVE_X_CHANGED_EVENT } from "@/lib/client/activeXSwitchEvents";
import { PUBLIC_NAV_ITEMS, isPublicNavItemActive } from "./publicNavigation";

const PUBLIC_ACCOUNT_IDLE_TIMEOUT_MS = 1200;
const PUBLIC_ACCOUNT_FALLBACK_DELAY_MS = 350;
const PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS = 5_000;
const PUBLIC_ACCOUNT_RETRY_EVENT = "flamenode:public-account-summary-retry";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

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

function requestPublicAccountRetry(): void {
  window.dispatchEvent(new Event(PUBLIC_ACCOUNT_RETRY_EVENT));
}

export function usePublicAccountSummary(
  enabled: boolean,
  preserveLoggedInOnFailure = false,
  lazy = false,
  open = false,
  deferUntilIdle = false,
): {
  user: PublicHeaderUser | null;
  loading: boolean;
  unavailable: boolean;
} {
  const [user, setUser] = React.useState<PublicHeaderUser | null>(null);
  const [loading, setLoading] = React.useState(enabled && (!lazy || open));
  const [unavailable, setUnavailable] = React.useState(false);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [idleReady, setIdleReady] = React.useState(!deferUntilIdle);
  const fetchedOnceRef = React.useRef(false);
  // Public header (lazy=false) fetches once after the initial hydration/idle
  // window. Menu open/close must not turn that one request into a request per
  // interaction, including when the first attempt ended in a temporary failure.
  const nonLazyAttemptedRef = React.useRef(false);
  const refreshRequestedRef = React.useRef(!lazy);
  const mountedRef = React.useRef(false);
  const inFlightRef = React.useRef<{
    generation: number;
    pendingGeneration: number | null;
    promise: Promise<
      | { kind: "summary"; summary: AccountSummaryResponse }
      | { kind: "unavailable" }
    >;
  } | null>(null);
  const refreshGenerationRef = React.useRef(0);
  const enabledRef = React.useRef(enabled);
  const preserveLoggedInOnFailureRef = React.useRef(preserveLoggedInOnFailure);
  const lazyRef = React.useRef(lazy);
  const openRef = React.useRef(open);

  enabledRef.current = enabled;
  preserveLoggedInOnFailureRef.current = preserveLoggedInOnFailure;
  lazyRef.current = lazy;
  openRef.current = open;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!enabled || lazy || !deferUntilIdle || idleReady) return;
    if (open) {
      setIdleReady(true);
      return;
    }

    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(
        () => setIdleReady(true),
        { timeout: PUBLIC_ACCOUNT_IDLE_TIMEOUT_MS },
      );
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(
      () => setIdleReady(true),
      PUBLIC_ACCOUNT_FALLBACK_DELAY_MS,
    );
    return () => window.clearTimeout(handle);
  }, [enabled, lazy, open, deferUntilIdle, idleReady]);

  React.useEffect(() => {
    if (!enabled) return;
    const requestRefresh = () => {
      refreshGenerationRef.current += 1;
      refreshRequestedRef.current = true;
      setUnavailable(false);
      setRefreshNonce((current) => current + 1);
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, requestRefresh);
    window.addEventListener(PUBLIC_ACCOUNT_RETRY_EVENT, requestRefresh);
    return () => {
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, requestRefresh);
      window.removeEventListener(PUBLIC_ACCOUNT_RETRY_EVENT, requestRefresh);
    };
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setUnavailable(false);
      return;
    }

    // 管理画面などのSSR最小ヘッダーは、メニューを開くまでsummaryを読まない。
    if (lazy && !open) {
      setLoading(false);
      return;
    }
    // 公開ページは初期SSR/RSCとaccount summaryを競合させない。ユーザーが先に
    // メニューを開いた場合だけidle待ちを飛ばして即時取得する。
    if (deferUntilIdle && !idleReady && !open) {
      setLoading(true);
      return;
    }
    if (!lazy && nonLazyAttemptedRef.current && !refreshRequestedRef.current) {
      setLoading(false);
      return;
    }
    if (lazy && fetchedOnceRef.current && !refreshRequestedRef.current) {
      setLoading(false);
      return;
    }

    const generation = refreshGenerationRef.current;
    const inFlight = inFlightRef.current;
    if (inFlight) {
      if (inFlight.generation !== generation) {
        inFlight.pendingGeneration = generation;
      }
      setLoading(true);
      return;
    }

    refreshRequestedRef.current = false;
    setLoading(true);

    const request: {
      generation: number;
      pendingGeneration: number | null;
      promise: Promise<
        | { kind: "summary"; summary: AccountSummaryResponse }
        | { kind: "unavailable" }
      >;
    } = {
      generation,
      pendingGeneration: null,
      promise: Promise.resolve({ kind: "unavailable" }),
    };
    request.promise = (async () => {
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
          return { kind: "unavailable" as const };
        }
        return {
          kind: "summary" as const,
          summary: (await response.json()) as AccountSummaryResponse,
        };
      } catch {
        return { kind: "unavailable" as const };
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();
    inFlightRef.current = request;

    void request.promise
      .then((result) => {
        if (!mountedRef.current || !enabledRef.current) return;
        if (request.generation !== refreshGenerationRef.current) return;

        if (result.kind === "summary") {
          const summary = result.summary;
          fetchedOnceRef.current = true;
          if (summary.loggedIn) {
            setUser(mapSummaryToHeaderUser(summary));
            setUnavailable(false);
          } else if (summary.unavailable) {
            setUnavailable(true);
          } else {
            if (!preserveLoggedInOnFailureRef.current) setUser(null);
            setUnavailable(false);
          }
        } else {
          setUnavailable(true);
          if (!preserveLoggedInOnFailureRef.current) setUser(null);
        }
      })
      .catch(() => {
        if (!mountedRef.current || !enabledRef.current) return;
        setUnavailable(true);
        if (!preserveLoggedInOnFailureRef.current) setUser(null);
      })
      .finally(() => {
        if (inFlightRef.current !== request) return;
        inFlightRef.current = null;
        if (!lazyRef.current) nonLazyAttemptedRef.current = true;
        if (!mountedRef.current || !enabledRef.current) return;

        const needsRefresh =
          refreshRequestedRef.current &&
          (request.pendingGeneration !== null ||
            request.generation !== refreshGenerationRef.current);
        const canFetchNow = !lazyRef.current || openRef.current;
        if (needsRefresh && canFetchNow) {
          setRefreshNonce((current) => current + 1);
        } else {
          setLoading(false);
        }
      });
  }, [
    enabled,
    preserveLoggedInOnFailure,
    lazy,
    open,
    deferUntilIdle,
    idleReady,
    refreshNonce,
  ]);

  return { user, loading, unavailable };
}

type PublicAccountIslandProps = {
  user: PublicHeaderUser | null;
  loading: boolean;
  unavailable: boolean;
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
            {activeEntry
              ? `@${activeEntry.x_user_id}`
              : "Active X ID未選択"}
          </span>
          <small>現在の投稿・コメントの活動名義</small>
        </div>
      </div>

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

      {user.management.canAccessAdmin || user.management.canAccessManage ? (
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
