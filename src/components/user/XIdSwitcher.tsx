"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./XIdSwitcher.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  sortXIdEntries,
  type XIdEntry,
} from "@/lib/xid/entries";
import { useActiveXSwitcher } from "./useActiveXSwitcher";

interface XIdSwitcherProps {
  entries: XIdEntry[];
  discordName: string;
  onSwitch?: (xUserId: string) => void;
}

export function XIdSwitcher({
  entries,
  discordName,
  onSwitch,
}: XIdSwitcherProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  const closeAfterSwitch =
    React.useCallback(() => {
      setOpen(false);
    }, []);

  const {
    entries: normalizedEntries,
    activeId,
    activeEntry: active,
    pending,
    error,
    clearError,
    switchTo,
  } = useActiveXSwitcher({
    entries,
    onSwitch,
    onSuccess: closeAfterSwitch,
  });

  const ref =
    React.useRef<HTMLDivElement>(null);

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

  const sorted = sortXIdEntries(
    normalizedEntries,
    {
      activeId,
      activeFirst: true,
    },
  );

  return (
    <div ref={ref} className={styles.root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="アクティブ X ID を切り替え"
        onClick={() => {
          clearError();
          setOpen((v) => !v);
        }}
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
          {active ? `@${active.x_user_id}` : "X ID未選択"}
        </span>
        {active?.approval_status === "pending" ? (
          <span
            className="fn-badge fn-badge-warning"
            style={{ fontSize: 9, padding: "1px 4px" }}
            title="承認待ち"
          >
            待
          </span>
        ) : active?.approval_status === "rejected" ? (
          <span
            className="fn-badge fn-badge-danger"
            style={{ fontSize: 9, padding: "1px 4px" }}
            title="却下"
          >
            却
          </span>
        ) : null}
        <Icon name="chevron-down" size={12} aria-hidden />
      </button>

      {open ? (
        <div role="listbox" className={styles.popover}>
          <div className={styles.popoverHeader}>
            {discordName} に紐づく X ID
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
          {sorted.length === 0 ? (
            <div className={styles.popoverEmpty}>
              X ID が連携されていません。
              <br />
              設定画面から申請できます。
            </div>
          ) : (
            sorted.map((entry, index) => {
              const selected = entry.x_user_id === activeId;
              return (
                <button
                  key={`${entry.x_user_id}-switch-${index}`}
                  role="option"
                  aria-selected={selected}
                  disabled={pending || entry.approval_status === "rejected"}
                  onClick={() => switchTo(entry)}
                  className={styles.option}
                  type="button"
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
                  {selected ? (
                    <Icon
                      name="check"
                      size={14}
                      className={styles.optionCheck}
                      title="現在のアクティブ X ID"
                    />
                  ) : null}
                </button>
              );
            })
          )}
          <div className={styles.divider} />
          <Link href="/dashboard/settings" className={styles.footerLink}>
            X ID 連携を管理
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
    return <span className="fn-badge fn-badge-warning" style={{ fontSize: 10, padding: "2px 6px" }}>承認待ち</span>;
  }
  return <span className="fn-badge fn-badge-danger" style={{ fontSize: 10, padding: "2px 6px" }}>却下</span>;
}
