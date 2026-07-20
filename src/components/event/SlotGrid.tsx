"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { releaseOwnSlot, reserveSlot } from "@/lib/actions/slot";
import { formatUnix } from "@/lib/utils/format";
import { buildSlotParts, formatSlotPartLabel } from "@/lib/utils/slotGrouping";
import styles from "./SlotGrid.module.css";

export interface SlotRow {
  id: string;
  event_id: string;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  reserved_by_user_id: string | null;
  reservation_group_id: string | null;
  video_id: string | null;
  updated_at: number;
  version: number;
}

export interface SlotGridProps {
  slots: SlotRow[];
  viewerXId: string | null;
  canReserve: boolean;
  slotType: "time" | "count";
  slotPartGapSec?: number;
}

type ConfirmState =
  | { kind: "reserve"; slot: SlotRow; displayName: string }
  | { kind: "release"; slot: SlotRow }
  | null;

export function SlotGrid({
  slots,
  viewerXId,
  canReserve,
  slotType,
  slotPartGapSec = 15 * 60,
}: SlotGridProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmState>(null);
  const [savedName, setSavedName] = React.useState("");

  React.useEffect(() => {
    try {
      setSavedName(window.localStorage.getItem("fn:lastSlotDisplayName") ?? "");
    } catch {
      setSavedName("");
    }
  }, []);

  const groups = React.useMemo(() => {
    if (slotType === "count") {
      return [{ label: "枠", rows: slots }];
    }
    return buildSlotParts(slots, slotPartGapSec).map((part) => ({
      label: formatSlotPartLabel(part, "short"),
      rows: part.rows,
    }));
  }, [slots, slotType, slotPartGapSec]);

  const redirectForGuardReason = (reason?: string): boolean => {
    if (typeof window === "undefined") return false;
    const next = `${window.location.pathname}${window.location.search}`;
    if (reason === "tos_required" || reason === "tos_reaccept_required") {
      router.push(`/rules?next=${encodeURIComponent(next)}`);
      return true;
    }
    if (reason === "unauthenticated") {
      router.push(`/entry?next=${encodeURIComponent(next)}`);
      return true;
    }
    return false;
  };

  const runReserve = (slot: SlotRow, displayName: string): void => {
    const fd = new FormData();
    fd.set("slot_id", slot.id);
    fd.set("display_name", displayName);
    fd.set("consecutive_count", "1");
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reserveSlot(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の確保に失敗しました。");
        return;
      }
      try {
        window.localStorage.setItem("fn:lastSlotDisplayName", displayName);
      } catch {
        // 保存不可環境では無視する。
      }
      setSavedName(displayName);
      setSuccess("枠を確保しました。");
      router.refresh();
    });
  };

  const runRelease = (slot: SlotRow): void => {
    const fd = new FormData();
    fd.set("slot_id", slot.id);
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await releaseOwnSlot(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の解放に失敗しました。");
        return;
      }
      setSuccess("枠を解放しました。");
      router.refresh();
    });
  };

  return (
    <div className={styles.root}>
      {error ? (
        <p className="fn-alert fn-alert--danger" role="alert">
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? <p className="fn-alert fn-alert--success">{success}</p> : null}

      {groups.map((group) => (
        <section key={group.label} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.label}</h2>
          <div className={styles.grid}>
            {group.rows.map((slot) => {
              const isOwn = Boolean(
                viewerXId && slot.x_user_id === viewerXId,
              );
              const label = slot.start_time
                ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(
                    slot.start_time,
                    { timeOnly: true },
                  )}`
                : (slot.slot_label ?? `#${slot.sort_order ?? "?"}`);
              return (
                <article
                  key={slot.id}
                  className={styles.slot}
                  data-status={slot.status}
                >
                  <div className={styles.slotMain}>
                    <strong>{label}</strong>
                    <span className="fn-muted fn-text-sm">
                      {slot.status === "available"
                        ? "空き"
                        : slot.status === "reserved"
                          ? (slot.display_name ?? `@${slot.x_user_id ?? "予約済み"}`)
                          : "提出済み"}
                    </span>
                  </div>
                  <div className={styles.slotActions}>
                    {slot.status === "available" ? (
                      <button
                        type="button"
                        className="fn-btn fn-btn-primary fn-btn-sm"
                        disabled={!canReserve || !viewerXId || busy}
                        onClick={() => {
                          const displayName = window.prompt(
                            "枠に表示する名前を入力してください。",
                            savedName || (viewerXId ? `@${viewerXId}` : ""),
                          );
                          if (!displayName?.trim()) return;
                          setConfirm({
                            kind: "reserve",
                            slot,
                            displayName: displayName.trim(),
                          });
                        }}
                      >
                        確保
                      </button>
                    ) : isOwn && slot.status === "reserved" ? (
                      <button
                        type="button"
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "release", slot })}
                      >
                        解放
                      </button>
                    ) : null}
                    {isOwn && slot.status === "reserved" ? (
                      <Link
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                        href={`/submit?slot=${encodeURIComponent(slot.id)}`}
                      >
                        作品登録
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "release" ? "枠を解放しますか?" : "枠を確保しますか?"}
        message={
          confirm?.kind === "release"
            ? "この予約を取り消して枠を空き状態へ戻します。"
            : "選択した1枠を確保します。"
        }
        confirmLabel={confirm?.kind === "release" ? "解放する" : "確保する"}
        tone={confirm?.kind === "release" ? "danger" : "default"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const state = confirm;
          setConfirm(null);
          if (state.kind === "release") runRelease(state.slot);
          else runReserve(state.slot, state.displayName);
        }}
      />
    </div>
  );
}
