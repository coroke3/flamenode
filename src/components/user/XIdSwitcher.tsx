"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./XIdSwitcher.module.css";
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

interface XIdSwitcherProps {
  entries: XIdEntry[];
  discordName: string;
  onSwitch?: (xUserId: string) => void;
}

function dedupeEntries(entries: readonly XIdEntry[]): XIdEntry[] {
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

export function XIdSwitcher({
  entries,
  discordName,
  onSwitch,
}: XIdSwitcherProps): React.ReactElement {
  const router = useRouter();
  const normalizedEntries = React.useMemo(() => dedupeEntries(entries), [entries]);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState(
    normalizedEntries.find((e) => e.is_active)?.x_user_id ?? null,
  );
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setActiveId(normalizedEntries.find((e) => e.is_active)?.x_user_id ?? null);
  }, [normalizedEntries]);

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

  const order = (s: XIdEntry["approval_status"]) =>
    s === "approved" ? 0 : s === "pending" ? 1 : 2;

  const sorted = [...normalizedEntries].sort((a, b) => {
    if (a.x_user_id === activeId) return -1;
    if (b.x_user_id === activeId) return 1;
    return (
      order(a.approval_status) - order(b.approval_status) ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });

  // activeId に一致する entry のみを「現在のアクティブ」とみなす。
  // approved / entries[0] へのフォールバックは「未選択なのに選択済みに見える」UX 不整合を生むため行わない。
  const active = normalizedEntries.find((e) => e.x_user_id === activeId) ?? null;

  const switchTo = (entry: XIdEntry) => {
    setError(null);
    if (entry.x_user_id === activeId) {
      setOpen(false);
      return;
    }
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
        setOpen(false);
      } else {
        setActiveId(prev);
        setError(res.message ?? "X ID の切り替えに失敗しました。");
      }
    });
  };

  return (
    <div ref={ref} className={styles.root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="アクティブ X ID を切り替え"
        onClick={() => {
          setError(null);
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
