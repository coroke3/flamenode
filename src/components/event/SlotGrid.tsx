"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { releaseOwnSlot, reserveSlot, extendOwnSlotGroup, mergeOwnSlotGroups } from "@/lib/actions/slot";
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
  slot_kind: "time" | "count" | null;
  slot_label: string | null;
  start_time: number | null;
  end_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  x_user_id: string | null;
  discord_user_id: string | null;
  reservation_group_id?: string | null;
}

export interface SlotGridProps {
  slots: SlotRow[];
  viewerXId: string | null;
  viewerDiscordId?: string | null;
  viewerActiveX?: string | null;
  canReserve: boolean;
  slotKind: "time" | "count";
  maxConsecutiveSlots?: number;
  /** 「部」分割閾値 (秒)。events.slot_part_gap_minutes から派生。未指定で 30 分。 */
  slotPartGapSec?: number;
}

interface SlotGroup {
  label: string;
  rows: SlotGroupRow[];
}

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

export function SlotGrid({
  slots,
  viewerXId,
  viewerDiscordId = null,
  viewerActiveX = null,
  canReserve,
  slotKind,
  maxConsecutiveSlots = 1,
  slotPartGapSec,
}: SlotGridProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [reservedSlotId, setReservedSlotId] = React.useState<string | null>(null);
  const [confirmReleaseId, setConfirmReleaseId] = React.useState<string | null>(null);
  const [confirmExtend, setConfirmExtend] = React.useState<ConfirmExtend | null>(null);
  const [confirmMerge, setConfirmMerge] = React.useState<ConfirmMerge | null>(null);
  const [reserveTarget, setReserveTarget] = React.useState<ReserveTarget | null>(null);
  const [mergeDisplayName, setMergeDisplayName] = React.useState<string>("");
  const [reserveDisplayName, setReserveDisplayName] = React.useState<string>("");
  const [reserveCount, setReserveCount] = React.useState("1");
  const [savedName, setSavedName] = React.useState<string>("");
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
    if (slotKind !== "time") return [{ label: "枠", rows: displayRows }];
    const parts = buildSlotParts(displayRows, slotPartGapSec);
    return parts.map((part) => ({
      label: formatSlotPartLabel(part, "full"),
      rows: part.rows,
    }));
  }, [displayRows, slotKind, slotPartGapSec]);

  const canTakeSlot = canReserve && !!viewerXId;

  const formatSlotLabel = (slot: SlotGroupRow): string => {
    if (slot.start_time) {
      return `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}${slot.end_time ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}` : ""}`;
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
        setError(result.message ?? "枠の確保に失敗しました。");
        return;
      }
      setSuccess("枠を確保しました。続けて作品情報を登録できます。");
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
        setError(result.message ?? "枠の解放に失敗しました。");
        return;
      }
      setSuccess("枠を解放しました。");
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
        setError(result.message ?? "枠の拡張に失敗しました。");
        return;
      }
      setSuccess("枠を拡張しました。");
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
        setError(result.message ?? "枠の結合に失敗しました。");
        return;
      }
      setSuccess("枠を結合しました。");
      router.refresh();
    });
  };

  /**
   * available 枠の直前・直後が同じ viewerActiveX の reserved 枠かどうかを
   * 元の slots 配列 (collapsed 前) で確認する。
   */
  const isMergeTarget = React.useCallback(
    (gapSlot: SlotGroupRow): boolean => {
      if (!viewerActiveX) return false;
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
        left.x_user_id === viewerActiveX &&
        right.status === "reserved" &&
        right.x_user_id === viewerActiveX
      );
    },
    [slots, viewerActiveX],
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
    !!viewerActiveX &&
    slots.some(
      (s) => s.status === "reserved" && s.x_user_id === viewerActiveX,
    );

  return (
    <div className={styles.wrap}>
      {error ? (
        <p role="alert" className={styles.errorBar}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className={styles.successBar}>
          <Icon name="check" size={12} aria-hidden /> {success}
          {reservedSlotId ? (
            <Link
              href={`/dashboard/post/slotted?slot=${reservedSlotId}`}
              className={styles.inlineAction}
            >
              作品情報を登録
              <Icon name="chevron-right" size={11} aria-hidden />
            </Link>
          ) : null}
        </p>
      ) : null}

      {hasMineSlot && maxConsecutiveSlots > 1 ? (
        <p className={styles.ownerHelp}>
          <strong>連続枠の操作:</strong>{" "}
          自分の枠の右側にある「<strong>前を追加</strong>」「<strong>後を追加</strong>」で
          隣接する空き枠を 1 つずつ取り込めます。
          自分の枠で挟まれた空き枠には「<strong>ここを埋めて結合</strong>」が表示され、
          1 グループにまとめられます。連続上限は {maxConsecutiveSlots} 枠です。
        </p>
      ) : null}

      <div className={styles.partsRow}>
        {groups.map((group, index) => (
          <section key={`part-${index}`} className={styles.partColumn}>
            <header className={styles.partHeader}>{group.label}</header>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{slotKind === "time" ? "日時" : "枠"}</th>
                  <th>状態 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((slot) => {
                  const isMine =
                    (!!viewerXId && slot.x_user_id === viewerXId) ||
                    (!slot.x_user_id && !!viewerDiscordId && slot.discord_user_id === viewerDiscordId);
                  const filled = slot.status !== "available";
                  return (
                    <tr
                      key={slot.id}
                      className={cn(
                        styles.row,
                        filled && styles.rowFilled,
                        isMine && styles.rowMine,
                      )}
                    >
                      <td className={styles.cellTime}>
                        {slot.start_time ? (
                          <span className={styles.timeStack}>
                            <span>{formatUnix(slot.start_time, { dateOnly: true })}</span>
                            <strong>
                              {formatUnix(slot.start_time, { timeOnly: true })}
                              {slot.end_time
                                ? ` - ${formatUnix(slot.end_time, { timeOnly: true })}`
                                : ""}
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
                              <span className={styles.slotName}>
                                {slot.display_name ??
                                  (slot.x_user_id ? `@${slot.x_user_id}` : "確保済み")}
                              </span>
                              {slot.x_user_id ? (
                                <span className={styles.slotId}>@{slot.x_user_id}</span>
                              ) : null}
                              {slot.is_group ? (
                                <span className="fn-badge fn-badge-soft">
                                  {slot.group_size}連続
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.slotActions}>
                              {slot.status === "submitted" ? (
                                <span className="fn-badge fn-badge-accent">提出済</span>
                              ) : (
                                <span className="fn-badge fn-badge-warning">確保済</span>
                              )}
                              {isMine && slot.status === "reserved" ? (
                                <>
                                  <Link
                                    href={`/dashboard/post/slotted?slot=${slot.id}`}
                                    className="fn-btn fn-btn-primary fn-btn-sm"
                                  >
                                    <Icon name="upload" size={10} aria-hidden /> 作品登録
                                  </Link>
                                  <button
                                    type="button"
                                    className="fn-btn fn-btn-ghost fn-btn-sm"
                                    disabled={busy}
                                    onClick={() => setConfirmReleaseId(slot.id)}
                                  >
                                    <Icon name="trash" size={10} aria-hidden /> 解放
                                  </button>
                                  {viewerActiveX ? (
                                    <>
                                      <button
                                        type="button"
                                        className="fn-btn fn-btn-secondary fn-btn-sm"
                                        disabled={busy || slot.group_size >= maxConsecutiveSlots}
                                        title={slot.group_size >= maxConsecutiveSlots ? "連続枠の上限に達しています" : "前に 1 枠追加"}
                                        onClick={() =>
                                          setConfirmExtend({
                                            slotId: slot.slot_ids[0] ?? slot.id,
                                            direction: "backward",
                                          })
                                        }
                                      >
                                        前を追加
                                      </button>
                                      <button
                                        type="button"
                                        className="fn-btn fn-btn-secondary fn-btn-sm"
                                        disabled={busy || slot.group_size >= maxConsecutiveSlots}
                                        title={slot.group_size >= maxConsecutiveSlots ? "連続枠の上限に達しています" : "後ろに 1 枠追加"}
                                        onClick={() =>
                                          setConfirmExtend({
                                            slotId: slot.slot_ids[slot.slot_ids.length - 1] ?? slot.id,
                                            direction: "forward",
                                          })
                                        }
                                      >
                                        後を追加
                                      </button>
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : isMergeTarget(slot) ? (
                          <div className={styles.mergeRow}>
                            <span className={styles.emptySlot}>空き</span>
                            <button
                              type="button"
                              className="fn-btn fn-btn-secondary fn-btn-sm"
                              disabled={busy}
                              onClick={() => {
                                const defaultName = getMergeDefaultName(slot);
                                setMergeDisplayName(defaultName);
                                setConfirmMerge({ gapSlotId: slot.id, defaultName });
                              }}
                            >
                              ここを埋めて結合
                            </button>
                          </div>
                        ) : canTakeSlot ? (
                          <button
                            type="button"
                            className={styles.emptySlotButton}
                            disabled={busy}
                            onClick={() => openReserveDialog(slot)}
                            aria-label={`${formatSlotLabel(slot)} を確保`}
                          >
                            <span className={styles.emptyCircle} aria-hidden>○</span>
                            <span className={styles.emptySlotButtonText}>空き枠</span>
                            <Icon name="plus" size={11} aria-hidden />
                          </button>
                        ) : canReserve ? (
                          <span className={styles.emptySlot}>
                            {viewerDiscordId ? "空き (X ID 未選択)" : "空き (要ログイン)"}
                          </span>
                        ) : (
                          <span className={styles.emptySlot}>空き</span>
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
                  { length: Math.min(Math.max(maxConsecutiveSlots, 1), 6) },
                  (_, i) => i + 1,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "単枠で確保" : `${n}連続で確保`}
                  </option>
                ))}
              </select>
              {maxConsecutiveSlots > 1 ? (
                <p className={styles.reserveDialogHint}>
                  連続枠は空きが隣接している場合だけまとめて確保されます。上限は {maxConsecutiveSlots} 枠です。
                </p>
              ) : null}
            </div>
            {viewerActiveX ? (
              <p className={styles.reserveDialogHint}>
                提出主体: <strong>@{viewerActiveX}</strong>
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
