"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./AccountMenu.module.css";
import { Icon } from "@/components/ui/Icon";
import { SignOutButton } from "@/components/auth/SignOutButton";
import {
  sortXIdEntries,
  type XIdEntry,
} from "@/lib/xid/entries";
import { resolveAccountMenuDisplayName } from "@/lib/account/accountMenuDisplay";
import { useActiveXSwitcher } from "./useActiveXSwitcher";

export interface AccountMenuUser {
  id: string;
  name: string;
  image: string | null;
  role: "user" | "admin" | "moderator" | string;
  management: {
    canAccessAdmin: boolean;
    canAccessManage: boolean;
    manageableEventCount?: number;
  };
  xIds: XIdEntry[];
  degraded?: true;
}

interface AccountMenuProps {
  user: AccountMenuUser;
  onSwitch?: (xUserId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AccountMenu({
  user,
  onSwitch,
  open: controlledOpen,
  onOpenChange,
}: AccountMenuProps): React.ReactElement {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(open) : next;
      if (controlledOpen === undefined) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [controlledOpen, onOpenChange, open],
  );

  const {
    entries: xIds,
    activeId,
    activeEntry,
    pending,
    error,
    clearError,
    switchTo,
  } = useActiveXSwitcher({
    entries: user.xIds,
    onSwitch,
    onSuccess: () => setOpen(false),
  });

  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const triggerIcon = activeEntry?.icon_url ?? user.image;
  const triggerName = resolveAccountMenuDisplayName({
    accountName: user.name,
    activeEntry,
    degraded: user.degraded === true,
  });
  const publicProfileHref =
    activeEntry?.approval_status === "approved"
      ? `/user/${encodeURIComponent(activeEntry.x_user_id)}`
      : null;

  // setActiveXId は承認済みだけ許可するため、切替候補も承認済みに揃える。
  const approvedXIds = sortXIdEntries(
    xIds.filter((entry) => entry.approval_status === "approved"),
  );
  const pendingXIds = sortXIdEntries(
    xIds.filter((entry) => entry.approval_status === "pending"),
  );
  const switchableXIds = sortXIdEntries(
    approvedXIds.filter((entry) => entry.x_user_id !== activeId),
  );
  const hasNoApprovedLinked = xIds.length > 0 && approvedXIds.length === 0;
  const hasPendingLinked = pendingXIds.length > 0;

  const headerInfo = (
    <>
      {triggerIcon ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={triggerIcon} alt="" className={styles.headerAvatar} />
      ) : (
        <span className={styles.headerAvatarFallback}>
          <Icon name="user" size={20} aria-hidden />
        </span>
      )}
      <div className={styles.headerBody}>
        <div className={styles.headerName}>{triggerName}</div>
        <div className={styles.headerId}>
          {activeEntry ? `@${activeEntry.x_user_id}` : user.name}
        </div>
      </div>
      {publicProfileHref ? (
        <Icon
          name="external"
          size={14}
          className={styles.headerLinkIcon}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <div ref={ref} className={styles.root}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="アカウントメニューを開く"
        onClick={() => {
          clearError();
          setOpen((current) => !current);
        }}
        className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
      >
        {triggerIcon ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={triggerIcon} alt="" className={styles.triggerAvatar} />
        ) : (
          <span className={styles.triggerAvatarFallback}>
            <Icon name="user" size={14} aria-hidden />
          </span>
        )}
        <span className={styles.triggerName}>{triggerName}</span>
        {activeEntry?.approval_status === "pending" ? (
          <span className={styles.badgeWarning} title="承認待ち" />
        ) : activeEntry?.approval_status === "rejected" ? (
          <span className={styles.badgeDanger} title="却下" />
        ) : null}
        <Icon name="chevron-down" size={12} aria-hidden />
      </button>

      {open ? (
        <div className={styles.popover} role="menu">
          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.section}>
            {publicProfileHref ? (
              <Link
                href={publicProfileHref}
                className={`${styles.headerInfo} ${styles.headerInfoLink}`}
                onClick={() => setOpen(false)}
              >
                {headerInfo}
              </Link>
            ) : (
              <div className={styles.headerInfo}>{headerInfo}</div>
            )}

            {!activeEntry ? (
              xIds.length === 0 ? (
                <div
                  className={`${styles.statusNotice} ${styles.noticeWarning}`}
                >
                  <strong>X ID未連携</strong>
                  <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                    いいね・セーブ・投稿には、利用規約への同意と承認済みの活動名義（Active X
                    ID）が必要です。枠確保は規約同意後から可能で、投稿は X ID 承認後です。
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <Link
                      href="/dashboard/settings"
                      className="fn-btn fn-btn-primary fn-btn-sm"
                      onClick={() => setOpen(false)}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      X IDを連携する
                    </Link>
                  </div>
                </div>
              ) : hasNoApprovedLinked ? (
                <div
                  className={`${styles.statusNotice} ${styles.noticeWarning}`}
                >
                  <strong>
                    {hasPendingLinked ? "X ID連携申請中" : "承認済みX IDなし"}
                  </strong>
                  <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                    {hasPendingLinked
                      ? "申請履歴と承認状況は設定から確認できます。"
                      : "承認済みの X ID がないためアクティブにできません。設定から申請してください。"}
                  </p>
                  {hasPendingLinked ? (
                    <div className={styles.pickList}>
                      {pendingXIds.map((entry, index) => (
                        <div
                          key={`${entry.x_user_id}-pending-${index}`}
                          className={styles.xidOption}
                          style={{ cursor: "default" }}
                        >
                          <span className={styles.xidBody}>
                            <span className={styles.xidName}>{entry.x_name}</span>
                            <span className={styles.xidId}>
                              @{entry.x_user_id}
                            </span>
                          </span>
                          <span
                            className="fn-badge fn-badge-warning"
                            style={{ fontSize: 9, padding: "1px 4px" }}
                          >
                            承認待ち
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <Link
                      href="/dashboard/settings"
                      className="fn-btn fn-btn-secondary fn-btn-sm"
                      onClick={() => setOpen(false)}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      設定を開く
                    </Link>
                  </div>
                </div>
              ) : (
                <div
                  className={`${styles.statusNotice} ${styles.noticeWarning}`}
                >
                  <strong>Active X ID未選択</strong>
                  <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                    承認済みの X ID からアクティブにするものを選んでください。
                  </p>
                  <div className={styles.pickList}>
                    {approvedXIds.map((entry, index) => (
                      <button
                        key={`${entry.x_user_id}-pick-${index}`}
                        type="button"
                        disabled={pending}
                        onClick={() => switchTo(entry)}
                        className={styles.xidOption}
                      >
                        {entry.icon_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={entry.icon_url}
                            alt=""
                            className={styles.xidAvatar}
                          />
                        ) : (
                          <span className={styles.xidAvatarFallback}>
                            <Icon name="user" size={12} aria-hidden />
                          </span>
                        )}
                        <span className={styles.xidBody}>
                          <span className={styles.xidName}>{entry.x_name}</span>
                          <span className={styles.xidId}>
                            @{entry.x_user_id}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Link
                      href="/dashboard/settings"
                      className="fn-btn fn-btn-secondary fn-btn-sm"
                      onClick={() => setOpen(false)}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      設定を開く
                    </Link>
                  </div>
                </div>
              )
            ) : activeEntry.approval_status === "pending" ? (
              <div
                className={`${styles.statusNotice} ${styles.noticeWarning}`}
              >
                <strong>承認待ち</strong>
                <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                  できること: 作品の閲覧、枠確保
                  <br />
                  できないこと: いいね、セーブ、投稿、コメント（承認後に利用可能）
                </p>
              </div>
            ) : activeEntry.approval_status === "rejected" ? (
              <div className={`${styles.statusNotice} ${styles.noticeDanger}`}>
                <strong>却下済み</strong>
                <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                  このX IDは使用できません。設定から別のX IDを申請してください。
                </p>
              </div>
            ) : null}
          </div>

          {switchableXIds.length > 0 ? (
            <>
              <div className={styles.divider} />
              <div className={styles.section}>
                <div className={styles.sectionTitle}>別の X ID に切り替え</div>
                {switchableXIds.map((entry, index) => (
                  <button
                    key={`${entry.x_user_id}-account-${index}`}
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => switchTo(entry)}
                    className={styles.xidOption}
                  >
                    {entry.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={entry.icon_url}
                        alt=""
                        className={styles.xidAvatar}
                      />
                    ) : (
                      <span className={styles.xidAvatarFallback}>
                        <Icon name="user" size={12} aria-hidden />
                      </span>
                    )}
                    <span className={styles.xidBody}>
                      <span className={styles.xidName}>{entry.x_name}</span>
                      <span className={styles.xidId}>@{entry.x_user_id}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className={styles.divider} />
          <div className={styles.section}>
            <Link
              href="/dashboard"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              <Icon name="grid" size={14} aria-hidden /> ダッシュボード
            </Link>
            <Link
              href="/dashboard/library"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              <Icon name="bookmark" size={14} aria-hidden /> ライブラリ
            </Link>
            <Link
              href="/dashboard/settings"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              <Icon name="settings" size={14} aria-hidden /> 設定
            </Link>
            <Link
              href="/entry"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              <Icon name="edit" size={14} aria-hidden /> 新規投稿
            </Link>
          </div>

          {user.management.canAccessAdmin || user.management.canAccessManage ? (
            <>
              <div className={styles.divider} />
              <div className={styles.section}>
                {user.management.canAccessManage ? (
                  <Link
                    href="/manage"
                    className={styles.menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name="users" size={14} aria-hidden /> 運営
                  </Link>
                ) : null}
                {user.management.canAccessAdmin ? (
                  <Link
                    href="/admin"
                    className={styles.menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name="settings" size={14} aria-hidden /> 管理
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}

          <div className={styles.divider} />
          <div className={styles.section}>
            <SignOutButton
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
            >
              <Icon name="logout" size={14} aria-hidden /> ログアウト
            </SignOutButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
