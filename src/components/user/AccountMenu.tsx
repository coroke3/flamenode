"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./AccountMenu.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { XIdEntry } from "@/lib/xid/entries";

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
}

interface AccountMenuProps {
  user: AccountMenuUser;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AccountMenu({
  user,
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

  const activeEntry = user.xIds.find((entry) => entry.is_active) ?? null;
  const triggerIcon = activeEntry?.icon_url ?? user.image;
  const triggerName = activeEntry?.x_name ?? (user.name?.trim() || "guest");
  const publicProfileHref =
    activeEntry?.approval_status === "approved"
      ? `/user/${encodeURIComponent(activeEntry.x_user_id)}`
      : null;
  const hasPendingOnly =
    user.xIds.length > 0 &&
    user.xIds.every((entry) => entry.approval_status === "pending");

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
        onClick={() => setOpen((current) => !current)}
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
              <div
                className={`${styles.statusNotice} ${styles.noticeWarning}`}
              >
                <strong>
                  {user.xIds.length === 0
                    ? "X ID未連携"
                    : hasPendingOnly
                      ? "X ID連携申請中"
                      : "Active X ID未選択"}
                </strong>
                <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                  {user.xIds.length === 0
                    ? "投稿・いいね・セーブにはX IDの連携が必要です。"
                    : hasPendingOnly
                      ? "申請履歴と承認状況は設定から確認できます。"
                      : "連携済みのX IDは設定から選択できます。"}
                </p>
                <div style={{ marginTop: 8 }}>
                  <Link
                    href="/dashboard/settings"
                    className="fn-btn fn-btn-primary fn-btn-sm"
                    onClick={() => setOpen(false)}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {user.xIds.length === 0 ? "X IDを連携する" : "設定を開く"}
                  </Link>
                </div>
              </div>
            ) : activeEntry.approval_status === "pending" ? (
              <div
                className={`${styles.statusNotice} ${styles.noticeWarning}`}
              >
                <strong>承認待ち</strong>
                <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                  できること: 枠確保
                  <br />
                  できないこと: 投稿, コメント, いいね, セーブ
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

          <div className={styles.divider} />
          <div className={styles.section}>
            <div className={styles.sectionTitle}>テーマ</div>
            <ThemeToggle variant="segmented" />
          </div>

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
            <Link
              href="/api/auth/signout"
              className={`${styles.menuItem} ${styles.menuItemDanger}`}
              onClick={() => setOpen(false)}
            >
              <Icon name="logout" size={14} aria-hidden /> ログアウト
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
