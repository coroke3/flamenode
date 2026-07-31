"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";
import {
  extendOwnSlotGroup,
  mergeOwnSlotGroups,
  releaseOwnSlot,
  reserveSlot,
} from "@/lib/actions/slot";
import { MAX_ATOMIC_SLOT_ROWS } from "@/lib/slots/atomicLimits";
import { formatUnix } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import {
  buildSlotParts,
  collapseReservationGroups,
  formatSlotPartLabel,
  type SlotBase,
  type SlotGroupRow,
} from "@/lib/utils/slotGrouping";
import styles from "./SlotGrid.module.css";

export interface SlotRow {
  id: string;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  is_owned_by_viewer: boolean;
  group_key: string | null;
}

export interface SlotGridProps {
  slots: SlotRow[];
  viewerXId: string | null;
  isAuthenticated?: boolean;
  canReserve: boolean;
  slotType: "time" | "count";
  maxSlotsPerVideo?: number;
  /** 「部」分割閾値 (秒)。events.slot_part_gap_minutes から派生。未指定で 15 分。 */
  slotPartGapSec?: number;
}

interface SlotGroup {
  label: string;
  rows: SlotDisplayRow[];
}

type SlotDisplayRow =
  | { kind: "slot"; slot: SlotGroupRow }
  | { kind: "break"; id: string; detail: string | null };

interface ConfirmExtend {
  slotId: string;
  direction: "forward" | "backward";
}

interface ConfirmMerge {
  gapSlotId: string;
  defaultName: string;
}

interface ReserveTarget {
  slot: SlotGroupRow;
  label: string;
}

const SLOT_PREVIEW_EVENT = "flamenode:slot-preview";

function formatBreakDetail(end: number | null, start: number | null): string | null {
  if (end == null || start == null || start <= end) return null;
  return `${formatUnix(end, { timeOnly: true })} - ${formatUnix(start, { timeOnly: true })}`;
}

export function SlotGrid({
  slots,
  viewerXId,
  isAuthenticated = false,
  canReserve,
  slotType,
  maxSlotsPerVideo = 1,
  slotPartGapSec,
}: SlotGridProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const [reservedSlotId, setReservedSlotId] = React.useState<string | null>(null);
  const [confirmReleaseId, setConfirmReleaseId] = React.useState<string | null>(null);
  const [confirmExtend, setConfirmExtend] = React.useState<ConfirmExtend | null>(null);
  const [confirmMerge, setConfirmMerge] = React.useState<ConfirmMerge | null>(null);
  const [reserveTarget, setReserveTarget] = React.useState<ReserveTarget | null>(null);
  const [actionMenuSlotId, setActionMenuSlotId] = React.useState<string | null>(null);
  const [mergeDisplayName, setMergeDisplayName] = React.useState<string>("");
  const [reserveDisplayName, setReserveDisplayName] = React.useState<string>("");
  const [reserveCount, setReserveCount] = React.useState("1");
  const [savedName, setSavedName] = React.useState<string>("");
  const atomicMaxConsecutiveSlots = Math.min(
    Math.max(Math.floor(maxSlotsPerVideo), 1),
    MAX_ATOMIC_SLOT_ROWS,
  );

  const redirectForGuardReason = React.useCallback(
    (reason?: string): boolean => {
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
    },
    [router],
  );

  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem("fn:lastSlotDisplayName");
      if (v) setSavedName(v);
    } catch {
      // localStorage 利用不可な環境では何もしない
    }
  }, []);
  const displayRows = React.useMemo(
    () => collapseReservationGroups(slots as SlotBase[]),
    [slots],
  );

  const groups = React.useMemo<SlotGroup[]>(() => {
    if (slotType !== "time") {
      return [{
        label: "枠",
        rows: displayRows.map((slot) => ({ kind: "slot", slot })),
      }];
    }

    const parts = buildSlotParts(displayRows, slotPartGapSec);
    const nextGroups: SlotGroup[] = [];
    let currentDateKey: string | null = null;
    let currentGroup: SlotGroup | null = null;
    let previousPartEnd: number | null = null;

    for (const part of parts) {
      const dateKey = part.start_time
        ? formatUnix(part.start_time, { dateOnly: true })
        : formatSlotPartLabel(part, "short");

      if (!currentGroup || currentDateKey !== dateKey) {
        currentDateKey = dateKey;
        currentGroup = { label: dateKey, rows: [] };
        nextGroups.push(currentGroup);
        previousPartEnd = null;
      } else if (currentGroup.rows.length > 0) {
        currentGroup.rows.push({
          kind: "break",
          id: `break-${dateKey}-${part.index}`,
          detail: formatBreakDetail(previousPartEnd, part.start_time),
        });
      }

      currentGroup.rows.push(
        ...part.rows.map((slot): SlotDisplayRow => ({ kind: "slot", slot })),
      );
      previousPartEnd = part.last_start_time ?? part.start_time ?? previousPartEnd;
    }

    return nextGroups;
  }, [displayRows, slotType, slotPartGapSec]);

  const canTakeSlot = canReserve && !!viewerXId;

  const formatSlotLabel = (slot: SlotGroupRow): string => {
    if (slot.start_time) {
      return `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`;
    }
    return slot.slot_label ?? `#${slot.sort_order ?? "?"}`;
  };

  const openReserveDialog = (slot: SlotGroupRow) => {
    setError(null);
    setSuccess(null);
    setReserveTarget({ slot, label: formatSlotLabel(slot) });
    setReserveDisplayName(savedName);
    setReserveCount("1");
  };

  const previewSlot = React.useCallback((slotId: string) => {
    window.dispatchEvent(
      new CustomEvent(SLOT_PREVIEW_EVENT, { detail: { slotId } }),
    );
  }, []);

  const onReserve = (
    slotId: string,
    displayName: string,
    consecutiveCount: string,
  ) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    fd.set("display_name", displayName);
    fd.set("consecutive_count", consecutiveCount);
    const dn = displayName.trim();
    if (dn) {
      try {
        window.localStorage.setItem("fn:lastSlotDisplayName", dn);
        setSavedName(dn);
      } catch {
        // localStorage 利用不可な環境では何もしない
      }
    }
    startTransition(async () => {
      const result = await reserveSlot(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の確保に失敗しました。");
        return;
      }
      setSuccess({
        message: "枠を確保しました。続けて作品情報を登録できます。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      setReservedSlotId(result.slotId ?? slotId);
      setReserveTarget(null);
      router.refresh();
    });
  };

  const onRelease = (slotId: string) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    startTransition(async () => {
      const result = await releaseOwnSlot(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の解放に失敗しました。");
        return;
      }
      setSuccess({
        message: "枠を解放しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      setReservedSlotId(null);
      router.refresh();
    });
  };

  const onExtend = (slotId: string, direction: "forward" | "backward") => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("slot_id", slotId);
    fd.set("direction", direction);
    startTransition(async () => {
      const result = await extendOwnSlotGroup(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の拡張に失敗しました。");
        return;
      }
      setSuccess({
        message: "枠を拡張しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      router.refresh();
    });
  };

  const onMerge = (gapSlotId: string, displayName: string) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("gap_slot_id", gapSlotId);
    fd.set("display_name", displayName);
    startTransition(async () => {
      const result = await mergeOwnSlotGroups(fd);
      if (!result.ok) {
        if (redirectForGuardReason(result.reason)) return;
        setError(result.message ?? "枠の結合に失敗しました。");
        return;
      }
      setSuccess({
        message: "枠を結合しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      router.refresh();
    });
  };

  /**
   * available 枠の直前・直後が同じ viewerXId の reserved 枠かどうかを
   * 元の slots 配列 (collapsed 前) で確認する。
   */
  const isMergeTarget = React.useCallback(
    (gapSlot: SlotGroupRow): boolean => {
      if (!viewerXId) return false;
      if (gapSlot.status !== "available") return false;
      const sorted = [...slots].sort((a, b) => {
        const aKey = a.sort_order ?? a.start_time ?? 0;
        const bKey = b.sort_order ?? b.start_time ?? 0;
        return aKey - bKey;
      });
      const idx = sorted.findIndex((s) => s.id === gapSlot.id);
      if (idx < 0) return false;
      const left = sorted[idx - 1];
      const right = sorted[idx + 1];
      if (!left || !right) return false;
      return (
        left.status === "reserved" &&
        left.is_owned_by_viewer &&
        right.status === "reserved" &&
        right.is_owned_by_viewer
      );
    },
    [slots, viewerXId],
  );

  /**
   * merge ボタン押下時に使う display_name のデフォルト値を
   * 隣接 reserved 枠から取得する。
   */
  const getMergeDefaultName = React.useCallback(
    (gapSlot: SlotGroupRow): string => {
      const sorted = [...slots].sort((a, b) => {
        const aKey = a.sort_order ?? a.start_time ?? 0;
        const bKey = b.sort_order ?? b.start_time ?? 0;
        return aKey - bKey;
      });
      const idx = sorted.findIndex((s) => s.id === gapSlot.id);
      if (idx < 0) return "";
      const left = sorted[idx - 1];
      return left?.display_name ?? "";
    },
    [slots],
  );

  if (slots.length === 0) {
    return (
      <p className="fn-muted fn-text-sm" style={{ padding: 16 }}>
        まだ枠が作成されていません。
      </p>
    );
  }

  const hasMineSlot =
    !!viewerXId &&
    slots.some((s) => s.status === "reserved" && s.is_owned_by_viewer);

  return (
    <div className={styles.wrap}>
      {error ? (
        <p role="alert" className={styles.errorBar}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <div role="status" className={styles.successCard}>
          <div className={styles.successCardBody}>
            <p className={styles.successCardMessage}>
              <Icon name="check" size={14} aria-hidden /> {success.message}
            </p>
            {success.pendingPublicReflection ? (
              <div style={{ marginTop: 8 }}>
                <PublicReflectionDelayNotice />
              </div>
            ) : null}
            {reservedSlotId ? (
              <>
                <Link
                  href={`/entry/slotted?slot=${reservedSlotId}`}
                  className="fn-btn fn-btn-primary"
                >
                  次へ: 作品情報を登録する
                  <Icon name="chevron-right" size={14} aria-hidden />
                </Link>
                <Link
                  href="/dashboard"
                  className={styles.successCardSecondary}
                >
                  あとで登録する (ダッシュボードから再開できます)
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasMineSlot && atomicMaxConsecutiveSlots > 1 ? (
        <p className={styles.ownerHelp}>
          <strong>連続枠の操作:</strong>{" "}
          自分の枠の右側にある「<strong>前を追加</strong>」「<strong>後を追加</strong>」で
          隣接する空き枠を 1 つずつ取り込めます。
          自分の枠で挟まれた空き枠には「<strong>ここを埋めて結合</strong>」が表示され、
          1 グループにまとめられます。連続上限は {atomicMaxConsecutiveSlots} 枠です。
        </p>
      ) : null}

      <div className={styles.legend} aria-label="枠の凡例">
        <span><i className={styles.legendAvailable} />空き</span>
        <span><i className={styles.legendReserved} />確保済</span>
        <span><i className={styles.legendPriority} />優先再取得中</span>
      </div>

      <div className={styles.partsRow}>
        {groups.map((group, index) => (
          <section key={`part-${index}`} className={styles.partColumn}>
            <header className={styles.partHeader}>{group.label}</header>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.timeCol} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>{slotType === "time" ? "日時" : "枠"}</th>
                  <th>状態 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((item) => {
                  if (item.kind === "break") {
                    return (
                      <tr key={item.id} className={styles.breakRow}>
                        <td colSpan={2} className={styles.breakCell}>
                          <span>休憩</span>
                          {item.detail ? <em>{item.detail}</em> : null}
                        </td>
                      </tr>
                    );
                  }

                  const slot = item.slot;
                  const isMine = slot.is_owned_by_viewer;
                  const filled = slot.status !== "available";
                  return (
                    <tr
                      key={slot.id}
                      className={cn(
                        styles.row,
                        filled && styles.rowFilled,
                        isMine && styles.rowMine,
                      )}
                      onPointerEnter={() => previewSlot(slot.id)}
                      onMouseEnter={() => previewSlot(slot.id)}
                      onClick={() => previewSlot(slot.id)}
                    >
                      <td className={styles.cellTime}>
                        {slot.start_time ? (
                          <span className={styles.timeStack}>
                            <span>{formatUnix(slot.start_time, { dateOnly: true })}</span>
                            <strong>
                              {formatUnix(slot.start_time, { timeOnly: true })}
                            </strong>
                          </span>
                        ) : (
                          (slot.slot_label ?? `#${slot.sort_order ?? "?"}`)
                        )}
                      </td>
                      <td className={styles.cellSlot}>
                        {filled ? (
                          <div className={styles.slotTaken}>
                            <div className={styles.slotIdentity}>
                              <span
                                className={cn(
                                  styles.slotName,
                                  isMine && slot.status === "reserved" && styles.slotNameMine,
                                )}
                              >
                                {slot.display_name ?? "確保済み"}
                              </span>
                            </div>
                            {isMine && slot.status === "reserved" ? (
                              <div className={styles.slotActions}>
                                <button
                                  type="button"
                                  className={styles.editSlotButton}
                                  aria-expanded={actionMenuSlotId === slot.id}
                                  disabled={busy}
                                  onClick={() =>
                                    setActionMenuSlotId((current) =>
                                      current === slot.id ? null : slot.id,
                                    )
                                  }
                                >
                                  編集
                                </button>
                                {actionMenuSlotId === slot.id ? (
                                  <div className={styles.slotActionMenu}>
                                    <Link
                                      href={`/entry/slotted?slot=${slot.id}`}
                                      className={styles.slotActionMenuItem}
                                      onClick={() => setActionMenuSlotId(null)}
                                    >
                                      <Icon name="upload" size={12} aria-hidden /> 作品登録
                                    </Link>
                                    <button
                                      type="button"
                                      className={styles.slotActionMenuItem}
                                      disabled={busy}
                                      onClick={() => {
                                        setActionMenuSlotId(null);
                                        setConfirmReleaseId(slot.id);
                                      }}
                                    >
                                      <Icon name="trash" size={12} aria-hidden /> 解放
                                    </button>
                                    {viewerXId ? (
                                      <>
                                        <button
                                          type="button"
                                          className={styles.slotActionMenuItem}
                                          disabled={busy || slot.group_size >= atomicMaxConsecutiveSlots}
                                          onClick={() => {
                                            setActionMenuSlotId(null);
                                            setConfirmExtend({
                                              slotId: slot.slot_ids[0] ?? slot.id,
                                              direction: "backward",
                                            });
                                          }}
                                        >
                                          前を追加
                                        </button>
                                        <button
                                          type="button"
                                          className={styles.slotActionMenuItem}
                                          disabled={busy || slot.group_size >= atomicMaxConsecutiveSlots}
                                          onClick={() => {
                                            setActionMenuSlotId(null);
                                            setConfirmExtend({
                                              slotId: slot.slot_ids[slot.slot_ids.length - 1] ?? slot.id,
                                              direction: "forward",
                                            });
                                          }}
                                        >
                                          後を追加
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : isMergeTarget(slot) ? (
                          <button
                            type="button"
                            className={cn(styles.emptySlotButton, styles.emptySlotButtonMerge)}
                            disabled={busy}
                            onClick={() => {
                              const defaultName = getMergeDefaultName(slot);
                              setMergeDisplayName(defaultName);
                              setConfirmMerge({ gapSlotId: slot.id, defaultName });
                            }}
                            aria-label={`${formatSlotLabel(slot)} を埋めて結合`}
                            title="ここを埋めて結合"
                          >
                            <span className={styles.emptyCircle} aria-hidden />
                          </button>
                        ) : canTakeSlot ? (
                          <button
                            type="button"
                            className={styles.emptySlotButton}
                            disabled={busy}
                            onClick={() => openReserveDialog(slot)}
                            aria-label={`${formatSlotLabel(slot)} を確保`}
                            title="枠を確保"
                          >
                            <span className={styles.emptyCircle} aria-hidden />
                          </button>
                        ) : canReserve ? (
                          <span
                            className={cn(styles.emptySlot, styles.emptySlotUnavailable)}
                            aria-label={isAuthenticated ? "空き。X ID 未選択" : "空き。ログインが必要です"}
                            title={isAuthenticated ? "X ID 未選択" : "ログインが必要です"}
                          >
                            <span className={styles.emptyCircle} aria-hidden />
                          </span>
                        ) : (
                          <span
                            className={cn(styles.emptySlot, styles.emptySlotUnavailable)}
                            aria-label="空き"
                            title="空き"
                          >
                            <span className={styles.emptyCircle} aria-hidden />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={confirmReleaseId !== null}
        title="枠を解放しますか?"
        message="この枠を解放します。よろしいですか?"
        confirmLabel="解放する"
        tone="danger"
        onConfirm={() => {
          const id = confirmReleaseId;
          setConfirmReleaseId(null);
          if (id) onRelease(id);
        }}
        onCancel={() => setConfirmReleaseId(null)}
      />

      <ConfirmDialog
        open={confirmExtend !== null}
        title={confirmExtend?.direction === "backward" ? "前の枠を追加しますか?" : "後ろの枠を追加しますか?"}
        message={
          confirmExtend?.direction === "backward"
            ? "自分のグループに前方の空き枠を 1 つ追加します。"
            : "自分のグループに後方の空き枠を 1 つ追加します。"
        }
        confirmLabel="追加する"
        tone="default"
        onConfirm={() => {
          const info = confirmExtend;
          setConfirmExtend(null);
          if (info) onExtend(info.slotId, info.direction);
        }}
        onCancel={() => setConfirmExtend(null)}
      />

      {confirmMerge !== null ? (
        <div
          className={styles.mergeDialogBackdrop}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmMerge(null);
          }}
        >
          <div
            className={styles.mergeDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="merge-dialog-title"
          >
            <p id="merge-dialog-title" className={styles.mergeDialogTitle}>
              ここを埋めて結合しますか?
            </p>
            <p className={styles.mergeDialogMessage}>
              空き枠を確保して左右の枠を 1 グループに結合します。
              表示名を確認してください。
            </p>
            <input
              type="text"
              className="fn-input"
              value={mergeDisplayName}
              onChange={(e) => setMergeDisplayName(e.target.value)}
              maxLength={80}
              placeholder="表示名・団体名"
              aria-label="表示名"
            />
            <div className={styles.mergeDialogFooter}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost"
                onClick={() => setConfirmMerge(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-primary"
                disabled={busy || mergeDisplayName.trim().length === 0}
                onClick={() => {
                  const info = confirmMerge;
                  setConfirmMerge(null);
                  if (info) onMerge(info.gapSlotId, mergeDisplayName.trim());
                }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              >
                結合する
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reserveTarget !== null ? (
        <div
          className={styles.reserveDialogBackdrop}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReserveTarget(null);
          }}
        >
          <form
            className={styles.reserveDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reserve-dialog-title"
            onSubmit={(e) => {
              e.preventDefault();
              const name = reserveDisplayName.trim();
              if (!name) {
                setError("表示名・団体名を入力してください。");
                return;
              }
              onReserve(reserveTarget.slot.id, name, reserveCount);
            }}
          >
            <div>
              <p id="reserve-dialog-title" className={styles.reserveDialogTitle}>
                枠を確保
              </p>
              <p className={styles.reserveDialogMessage}>
                {reserveTarget.label}
              </p>
            </div>
            <div className={styles.reserveDialogField}>
              <label className="fn-label" htmlFor="reserve-display-name">
                表示名・団体名
              </label>
              <input
                id="reserve-display-name"
                type="text"
                className="fn-input"
                value={reserveDisplayName}
                onChange={(e) => setReserveDisplayName(e.target.value)}
                maxLength={80}
                placeholder="例: FlameNode制作部"
                required
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <div className={styles.reserveDialogField}>
              <label className="fn-label" htmlFor="reserve-count">
                取得する枠数
              </label>
              <select
                id="reserve-count"
                className="fn-select"
                value={reserveCount}
                onChange={(e) => setReserveCount(e.target.value)}
              >
                {Array.from(
                  { length: atomicMaxConsecutiveSlots },
                  (_, i) => i + 1,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "単枠で確保" : `${n}連続で確保`}
                  </option>
                ))}
              </select>
              {atomicMaxConsecutiveSlots > 1 ? (
                <p className={styles.reserveDialogHint}>
                  連続枠は空きが隣接している場合だけまとめて確保されます。上限は {atomicMaxConsecutiveSlots} 枠です。
                </p>
              ) : null}
            </div>
            {viewerXId ? (
              <p className={styles.reserveDialogHint}>
                提出主体: <strong>@{viewerXId}</strong>
              </p>
            ) : null}
            <div className={styles.reserveDialogFooter}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost"
                onClick={() => setReserveTarget(null)}
                disabled={busy}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="fn-btn fn-btn-primary"
                disabled={busy || reserveDisplayName.trim().length === 0}
                aria-busy={busy}
              >
                <Icon name="plus" size={12} aria-hidden />
                {busy ? "確保中..." : "確保する"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
