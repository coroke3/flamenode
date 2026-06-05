"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./AccountMenu.module.css";
import { Icon } from "@/components/ui/Icon";
import { setActiveXId } from "@/lib/actions/xid";
import { normalizeXId } from "@/lib/utils/xid";

export interface XIdEntry {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "approved" | "pending" | "rejected";
  is_active: boolean;
}

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
  onSwitch?: (xUserId: string) => void;
}

type Mode = "light" | "dark";
const STORAGE_KEY = "fn-theme";

function dedupeXIds(entries: readonly XIdEntry[]): XIdEntry[] {
  const seen = new Set<string>();
  const out: XIdEntry[] = [];
  for (const entry of entries) {
    const normalized = normalizeXId(entry.x_user_id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      ...entry,
      x_user_id: normalized,
      x_name: entry.x_name?.trim() || `@${normalized}`,
    });
  }
  return out;
}

function getDeviceMode(): Mode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(mode: Mode, persist = true) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", mode);
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

export function AccountMenu({
  user,
  onSwitch,
}: AccountMenuProps): React.ReactElement {
  const router = useRouter();
  const xIds = React.useMemo(() => dedupeXIds(user.xIds), [user.xIds]);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState(
    xIds.find((e) => e.is_active)?.x_user_id ?? null,
  );
  const [pending, startTransition] = React.useTransition();
  const [themeMode, setThemeMode] = React.useState<Mode>("light");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setActiveId(xIds.find((e) => e.is_active)?.x_user_id ?? null);
  }, [xIds]);

  React.useEffect(() => {
    let initial: Mode = getDeviceMode();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") initial = saved;
    } catch {
      /* noop */
    }
    setThemeMode(initial);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // activeId に一致する entry のみを「現在のアクティブ」とみなす。
  // approved への暗黙フォールバックは、未選択なのにヘッダーで承認済み X ID が
  // アクティブに見える UX 不整合を生むため行わない。
  const activeEntry =
    xIds.find((e) => e.x_user_id === activeId) ?? null;

  const switchTo = (entry: XIdEntry) => {
    setError(null);
    if (entry.x_user_id === activeId) return;
    if (entry.approval_status === "rejected") {
      setError("却下された X ID はアクティブにできません。");
      return;
    }

    const prev = activeId;
    setActiveId(entry.x_user_id);
    const fd = new FormData();
    fd.set("x_user_id", entry.x_user_id);

    startTransition(async () => {
      const res = await setActiveXId(fd);
      if (res.ok) {
        onSwitch?.(entry.x_user_id);
        router.refresh();
      } else {
        setActiveId(prev);
        setError(res.message ?? "X ID の切り替えに失敗しました。");
      }
    });
  };

  const handleThemeChange = (nextMode: Mode) => {
    setThemeMode(nextMode);
    applyTheme(nextMode);
  };

  // トリガー用のアイコンと名前
  const triggerIcon = activeEntry?.icon_url ?? user.image;
  const triggerName = activeEntry ? activeEntry.x_name : user.name?.trim() || "guest";

  const order = (s: XIdEntry["approval_status"]) =>
    s === "approved" ? 0 : s === "pending" ? 1 : 2;

  const sortedXIds = [...xIds].sort((a, b) => {
    if (a.x_user_id === activeId) return -1;
    if (b.x_user_id === activeId) return 1;
    return (
      order(a.approval_status) - order(b.approval_status) ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });

  return (
    <div ref={ref} className={styles.root}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="アカウントメニューを開く"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
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

          {/* セクション1: 主体ステータス表示 */}
          <div className={styles.section}>
            <div className={styles.headerInfo}>
              {triggerIcon ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={triggerIcon}
                  alt=""
                  className={styles.headerAvatar}
                />
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
            </div>

            {!activeEntry ? (
              <div className={`${styles.statusNotice} ${styles.noticeWarning}`}>
                <strong>X ID未選択</strong>
                <p style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                  投稿・いいね・セーブにはX IDの選択が必要です。
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
            ) : activeEntry.approval_status === "pending" ? (
              <div className={`${styles.statusNotice} ${styles.noticeWarning}`}>
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
                  このX IDは使用できません。再申請または別のX IDを選択してください。
                </p>
              </div>
            ) : null}
          </div>

          <div className={styles.divider} />

          {/* セクション2: X ID切替 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>X IDを切り替え</div>
            {sortedXIds.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                連携済みの X ID がありません。
              </div>
            ) : (
              sortedXIds.map((entry, index) => {
                const isSelected = entry.x_user_id === activeId;
                return (
                  <button
                    key={`${entry.x_user_id}-account-${index}`}
                    type="button"
                    role="menuitem"
                    disabled={pending || entry.approval_status === "rejected"}
                    onClick={() => switchTo(entry)}
                    className={`${styles.xidOption} ${isSelected ? styles.xidOptionActive : ""}`}
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
                    {entry.approval_status === "pending" ? (
                      <span className="fn-badge fn-badge-warning" style={{ fontSize: 9, padding: "1px 4px" }}>
                        承認待ち
                      </span>
                    ) : entry.approval_status === "rejected" ? (
                      <span className="fn-badge fn-badge-danger" style={{ fontSize: 9, padding: "1px 4px" }}>
                        却下
                      </span>
                    ) : null}
                    {isSelected ? (
                      <Icon
                        name="check"
                        size={14}
                        className={styles.checkIcon}
                      />
                    ) : null}
                  </button>
                );
              })
            )}
            <div style={{ marginTop: 4 }}>
              <Link
                href="/dashboard/settings"
                className={styles.menuItem}
                style={{ fontSize: 12, padding: "6px 8px", color: "var(--text-muted)" }}
                onClick={() => setOpen(false)}
              >
                <Icon name="settings" size={13} aria-hidden /> X ID連携を管理
              </Link>
            </div>
          </div>

          <div className={styles.divider} />

          {/* セクション3: テーマ切替 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>テーマ</div>
            <div className={styles.themeGroup}>
              <button
                type="button"
                className={`${styles.themeBtn} ${themeMode === "light" ? styles.themeBtnActive : ""}`}
                onClick={() => handleThemeChange("light")}
              >
                <Icon name="sun" size={13} /> ライト
              </button>
              <button
                type="button"
                className={`${styles.themeBtn} ${themeMode === "dark" ? styles.themeBtnActive : ""}`}
                onClick={() => handleThemeChange("dark")}
              >
                <Icon name="moon" size={13} /> ダーク
              </button>
            </div>
          </div>

          <div className={styles.divider} />

          {/* セクション4: ダッシュボード・ナビゲーション */}
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
              href="/dashboard/post"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              <Icon name="edit" size={14} aria-hidden /> 新規投稿
            </Link>
          </div>

          {/* セクション5: 管理 / 運営 (権限時のみ) */}
          {user.management.canAccessAdmin || user.management.canAccessManage ? (
            <>
              <div className={styles.divider} />
              <div className={styles.section}>
                {user.management.canAccessAdmin ? (
                  <Link
                    href="/admin"
                    className={styles.menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name="settings" size={14} aria-hidden /> 管理
                  </Link>
                ) : user.management.canAccessManage ? (
                  <Link
                    href="/manage"
                    className={styles.menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name="users" size={14} aria-hidden /> 運営
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}

          <div className={styles.divider} />

          {/* セクション6: ログアウト */}
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
