"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./XIdSwitcher.module.css";
import { Icon } from "@/components/ui/Icon";
import { setActiveXId } from "@/lib/actions/xid";

export interface XIdEntry {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "approved" | "pending" | "rejected";
  is_active: boolean;
}

interface XIdSwitcherProps {
  entries: XIdEntry[];
  discordName: string;
  onSwitch?: (xUserId: string) => void;
}

/**
 * 上部メニューバーに常駐するアクティブ X ID スイッチャー。
 * 即時切替の誤操作を防ぐため、クリックでポップオーバーを開いて選ぶ。
 */
export function XIdSwitcher({
  entries,
  discordName,
  onSwitch,
}: XIdSwitcherProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const active = entries.find((e) => e.is_active) ?? entries[0];

  const order = (s: XIdEntry["approval_status"]) =>
    s === "approved" ? 0 : s === "pending" ? 1 : 2;
  const sorted = [...entries].sort(
    (a, b) => order(a.approval_status) - order(b.approval_status),
  );

  return (
    <div ref={ref} className={styles.root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={styles.trigger}
      >
        {active?.icon_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={active.icon_url} alt="" className={styles.triggerIcon} />
        ) : (
          <span className={styles.triggerIconFallback}>
            <Icon name="user" size={12} aria-hidden />
          </span>
        )}
        <span className={styles.triggerName}>
          {active?.x_name ?? "未設定"}
        </span>
        <Icon name="chevron-down" size={12} aria-hidden />
      </button>

      {open ? (
        <div role="listbox" className={styles.popover}>
          <div className={styles.popoverHeader}>
            {discordName} に紐づく X ID
          </div>
          {sorted.length === 0 ? (
            <div className={styles.popoverEmpty}>
              X ID が連携されていません。
              <br />
              設定画面から追加してください。
            </div>
          ) : (
            sorted.map((entry) => (
              <button
                key={entry.x_user_id}
                role="option"
                aria-selected={entry.is_active}
                disabled={pending || entry.approval_status !== "approved"}
                onClick={() => {
                  if (entry.is_active) {
                    setOpen(false);
                    return;
                  }
                  if (entry.approval_status !== "approved") {
                    return;
                  }
                  const fd = new FormData();
                  fd.set("x_user_id", entry.x_user_id);
                  startTransition(async () => {
                    const res = await setActiveXId(fd);
                    if (res.ok) {
                      onSwitch?.(entry.x_user_id);
                      router.refresh();
                    }
                    setOpen(false);
                  });
                }}
                className={styles.option}
              >
                {entry.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={entry.icon_url}
                    alt=""
                    className={styles.optionIcon}
                  />
                ) : (
                  <span className={styles.optionIconFallback}>
                    <Icon name="user" size={14} aria-hidden />
                  </span>
                )}
                <span className={styles.optionBody}>
                  <span className={styles.optionName}>{entry.x_name}</span>
                  <span className={styles.optionId}>@{entry.x_user_id}</span>
                </span>
                <ApprovalBadge status={entry.approval_status} />
                {entry.is_active ? (
                  <Icon
                    name="check"
                    size={14}
                    className={styles.optionCheck}
                    title="現在のアクティブ X ID"
                  />
                ) : null}
              </button>
            ))
          )}
          <div className={styles.divider} />
          <Link href="/dashboard/settings" className={styles.footerLink}>
            X ID 連携を管理…
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalBadge({
  status,
}: {
  status: XIdEntry["approval_status"];
}): React.ReactElement | null {
  if (status === "approved") return null;
  if (status === "pending") {
    return <span className="fn-badge fn-badge-warning">承認待ち</span>;
  }
  return <span className="fn-badge fn-badge-danger">再申請</span>;
}
