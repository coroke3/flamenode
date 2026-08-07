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
import { countContiguousAvailableForward } from "@/lib/slots/contiguousAvailable";
import { normalizeMaxSlotsPerVideo } from "@/lib/slots/limits";
import { formatUnix } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import {
  annotateReservationGroups,
  buildSlotParts,
  formatSlotPartLabel,
  sortSlotsChronologically,
  type SlotAnnotatedRow,
  type SlotBase,
} from "@/lib/utils/slotGrouping";
import { areSlotsInSamePart } from "@/lib/utils/slotGroupingCore";
import type { SlotViewerRelation } from "@/lib/slots/slotIdentityCore";
import { redirectForGuardReason as redirectForGuard } from "@/lib/client/guardRedirect";
import { normalizeXId } from "@/lib/utils/xid";
import styles from "./SlotGrid.module.css";

export interface SlotRow {
  id: string;
  slot_label: string | null;
  start_time: number | null;
  sort_order: number | null;
  status: "available" | "reserved" | "submitted";
  display_name: string | null;
  is_owned_by_viewer: boolean;
  viewer_relation?: SlotViewerRelation;
  group_key: string | null;
  /** 本人枠のみ。結合 UI の X 一致判定用。他人には渡さない。 */
  x_user_id?: string | null;
}

export interface SlotGridProps {
  slots: SlotRow[];
  viewerXId: string | null;
  isAuthenticated?: boolean;
  canReserve: boolean;
  /** ログイン + TOS + X申請済み(pending可)。サーバー writeGuard requested_x と同条件。 */
  canTakeSlot: boolean;
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
  | { kind: "slot"; slot: SlotAnnotatedRow }
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
  slot: SlotAnnotatedRow;
  label: string;
}

const SLOT_PREVIEW_EVENT = "flamenode:slot-preview";
const LEGACY_SLOT_DISPLAY_NAME_KEY = "fn:lastSlotDisplayName";

function slotDisplayNameStorageKey(viewerXId: string | null): string {
  const normalized = normalizeXId(viewerXId ?? "");
  return normalized
    ? `${LEGACY_SLOT_DISPLAY_NAME_KEY}:${normalized}`
    : `${LEGACY_SLOT_DISPLAY_NAME_KEY}:unassigned`;
}

function readSavedSlotDisplayName(viewerXId: string | null): string {
  if (typeof window === "undefined") return "";
  try {
    const scopedKey = slotDisplayNameStorageKey(viewerXId);
    const scoped = window.localStorage.getItem(scopedKey);
    if (scoped) return scoped;
    const legacy = window.localStorage.getItem(LEGACY_SLOT_DISPLAY_NAME_KEY);
    return legacy ?? "";
  } catch {
    return "";
  }
}

function formatBreakDetail(end: number | null, start: number | null): string | null {
  if (end == null || start == null || start <= end) return null;
  return `${formatUnix(end, { timeOnly: true })} - ${formatUnix(start, { timeOnly: true })}`;
}

export function SlotGrid({
  slots,
  viewerXId,
  isAuthenticated = false,
  canReserve,
  canTakeSlot,
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
  const eventMaxSlots = normalizeMaxSlotsPerVideo(maxSlotsPerVideo);
  const slotGapSec = slotPartGapSec ?? 15 * 60;

  const redirectForGuardReason = React.useCallback(
    (reason?: string): boolean => {
      if (typeof window === "undefined") return false;
      const next = `${window.location.pathname}${window.location.search}`;
      return redirectForGuard(router, reason, next);
    },
    [router],
  );

  React.useEffect(() => {
    setError(null);
    setSuccess(null);
    setReservedSlotId(null);
    setConfirmReleaseId(null);
    setConfirmExtend(null);
    setConfirmMerge(null);
    setReserveTarget(null);
    setActionMenuSlotId(null);
    setMergeDisplayName("");
    setReserveDisplayName("");
    setReserveCount("1");
    setSavedName(readSavedSlotDisplayName(viewerXId));
  }, [viewerXId]);
  const displayRows = React.useMemo(
    () => annotateReservationGroups(slots as SlotBase[]),
    [slots],
  );

  const releaseTargetSlot = React.useMemo(
    () => displayRows.find((slot) => slot.id === confirmReleaseId) ?? null,
    [displayRows, confirmReleaseId],
  );

  const reserveMaxCount = React.useMemo(() => {
    if (!reserveTarget) return eventMaxSlots;
    return countContiguousAvailableForward({
      slots,
      anchorId: reserveTarget.slot.id,
      eventMax: eventMaxSlots,
      gapSec: slotGapSec,
    });
  }, [reserveTarget, slots, eventMaxSlots, slotGapSec]);

  React.useEffect(() => {
    const current = Number(reserveCount);
    if (Number.isFinite(current) && current > reserveMaxCount) {
      setReserveCount(String(reserveMaxCount));
    }
  }, [reserveMaxCount]);

  const reservePreviewSlots = React.useMemo(() => {
    if (!reserveTarget) return [] as SlotRow[];
    const count = Number(reserveCount);
    if (!Number.isFinite(count) || count < 2) return [];
    const ordered = sortSlotsChronologically(slots);
    const anchorIndex = ordered.findIndex((slot) => slot.id === reserveTarget.slot.id);
    if (anchorIndex < 0) return [];
    const picked: SlotRow[] = [ordered[anchorIndex]];
    for (let i = anchorIndex + 1; i < ordered.length && picked.length < count; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (current.status !== "available") break;
      if (!areSlotsInSamePart(previous, current, slotGapSec)) break;
      picked.push(current);
    }
    return picked;
  }, [reserveTarget, reserveCount, slots, slotGapSec]);

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

  const formatSlotLabel = (
    slot: Pick<SlotRow, "start_time" | "slot_label"> & {
      sort_order?: number | null;
    },
  ): string => {
    if (slot.start_time) {
      return `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`;
    }
    return slot.slot_label ?? `#${slot.sort_order ?? "?"}`;
  };

  const openReserveDialog = (slot: SlotAnnotatedRow) => {
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
        window.localStorage.setItem(slotDisplayNameStorageKey(viewerXId), dn);
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
      const resultMeta = result as typeof result & {
        slotCount?: number;
        groupSize?: number;
      };
      const reservedCount =
        resultMeta.slotCount ?? resultMeta.groupSize ?? Number(consecutiveCount);
      setSuccess({
        message:
          reservedCount > 1
            ? `${reservedCount}枠連続で確保しました。`
            : "枠を確保しました。続けて作品情報を登録できます。",
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
        message:
          (result.groupSize ?? 0) > 1
            ? `連続${result.groupSize}枠になりました。`
            : "枠を拡張しました。",
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
        message:
          (result.groupSize ?? 0) > 1
            ? `${result.groupSize}枠を1つの連続枠にまとめました。`
            : "枠を結合しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      router.refresh();
    });
  };

  /**
   * 自分の reserved で挟まれた available か（上限超過含む）。
   * 上限超過時は結合不可だが、通常確保へ落とさず disabled merge を出す。
   */
  const getMergeCandidate = React.useCallback(
    (
      gapSlot: SlotAnnotatedRow,
    ): { ok: true } | { ok: false; overflowMessage: string } | null => {
      if (gapSlot.status !== "available") return null;
      const sorted = sortSlotsChronologically(slots);
      const idx = sorted.findIndex((s) => s.id === gapSlot.id);
      if (idx < 0) return null;
      const left = sorted[idx - 1];
      const right = sorted[idx + 1];
      const gap = sorted[idx];
      if (!left || !right || !gap) return null;
      if (
        left.status !== "reserved" ||
        !left.is_owned_by_viewer ||
        right.status !== "reserved" ||
        !right.is_owned_by_viewer
      ) {
        return null;
      }
      if ((left.x_user_id ?? null) !== (right.x_user_id ?? null)) {
        return null;
      }
      if (
        !areSlotsInSamePart(left, gap, slotGapSec) ||
        !areSlotsInSamePart(gap, right, slotGapSec)
      ) {
        return null;
      }
      const leftSize = left.group_key
        ? sorted.filter((slot) => slot.group_key === left.group_key).length
        : 1;
      const rightSize = right.group_key
        ? sorted.filter((slot) => slot.group_key === right.group_key).length
        : 1;
      const total = leftSize + 1 + rightSize;
      if (total > eventMaxSlots) {
        return {
          ok: false,
          overflowMessage: `結合すると${total}枠となり、イベント上限${eventMaxSlots}枠を超えます`,
        };
      }
      return { ok: true };
    },
    [slots, eventMaxSlots, slotGapSec],
  );

  const canExtendDirection = React.useCallback(
    (slot: SlotAnnotatedRow, direction: "forward" | "backward"): boolean => {
      if (slot.group_size >= eventMaxSlots) return false;
      const sorted = sortSlotsChronologically(slots);
      const edgeId =
        direction === "backward" ? slot.group_first_slot_id : slot.group_last_slot_id;
      const edgeIndex = sorted.findIndex((row) => row.id === edgeId);
      if (edgeIndex < 0) return false;
      const edge = sorted[edgeIndex];
      const neighbor =
        direction === "backward" ? sorted[edgeIndex - 1] : sorted[edgeIndex + 1];
      if (!edge || !neighbor || neighbor.status !== "available") return false;
      return direction === "backward"
        ? areSlotsInSamePart(neighbor, edge, slotGapSec)
        : areSlotsInSamePart(edge, neighbor, slotGapSec);
    },
    [slots, eventMaxSlots, slotGapSec],
  );

  const getMergeDefaultName = React.useCallback(
    (gapSlot: SlotAnnotatedRow): string => {
      const sorted = sortSlotsChronologically(slots);
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

  const hasMineSlot = slots.some(
    (s) => s.status === "reserved" && s.is_owned_by_viewer,
  );

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

      {hasMineSlot && eventMaxSlots > 1 ? (
        <p className={styles.ownerHelp}>
          <strong>連続枠の操作:</strong>{" "}
          自分の枠の右側にある「<strong>前を追加</strong>」「<strong>後を追加</strong>」で
          隣接する空き枠を 1 つずつ取り込めます。
          自分の枠で挟まれた空き枠には「<strong>ここを埋めて結合</strong>」が表示され、
          1 グループにまとめられます。連続上限は {eventMaxSlots} 枠です。
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
                  const slotDisplayName = slot.display_name ?? "確保済み";
                  const nameVisible = Boolean(slot.display_name) || isMine;
                  const showGroupPosition =
                    slot.is_group && slot.group_position > 1 && nameVisible;
                  const hasIntegrityError = slot.integrity_error != null;
                  const isAccountOther = slot.viewer_relation === "account_other";
                  const canOperateMine =
                    isMine &&
                    slot.status === "reserved" &&
                    !hasIntegrityError &&
                    !isAccountOther;
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
                              <div className={styles.slotNameRow}>
                                <span
                                  className={cn(
                                    styles.slotName,
                                    canOperateMine && styles.slotNameMine,
                                  )}
                                >
                                  {slotDisplayName}
                                </span>
                                {showGroupPosition ? (
                                  <span
                                    className={styles.slotGroupPosition}
                                    aria-label={`連続枠 ${slot.group_position}枠目 / 全${slot.group_size}枠`}
                                  >
                                    {slot.group_position}枠目
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {hasIntegrityError ? (
                              <p className={styles.slotIntegrityNotice}>
                                枠グループの状態を確認できませんでした。画面を更新してください。
                              </p>
                            ) : null}
                            {canOperateMine ? (
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
                                    <button
                                      type="button"
                                      className={styles.slotActionMenuItem}
                                      disabled={
                                        busy || !canExtendDirection(slot, "backward")
                                      }
                                      title={
                                        canExtendDirection(slot, "backward")
                                          ? undefined
                                          : "前方に連続する空き枠がありません"
                                      }
                                      onClick={() => {
                                        setActionMenuSlotId(null);
                                        setConfirmExtend({
                                          slotId: slot.group_first_slot_id,
                                          direction: "backward",
                                        });
                                      }}
                                    >
                                      前を追加
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.slotActionMenuItem}
                                      disabled={
                                        busy || !canExtendDirection(slot, "forward")
                                      }
                                      title={
                                        canExtendDirection(slot, "forward")
                                          ? undefined
                                          : "後方に連続する空き枠がありません"
                                      }
                                      onClick={() => {
                                        setActionMenuSlotId(null);
                                        setConfirmExtend({
                                          slotId: slot.group_last_slot_id,
                                          direction: "forward",
                                        });
                                      }}
                                    >
                                      後を追加
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : (() => {
                          const mergeCandidate = getMergeCandidate(slot);
                          if (mergeCandidate && !hasIntegrityError) {
                            if (mergeCandidate.ok) {
                              return (
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
                              );
                            }
                            return (
                              <span
                                className={cn(
                                  styles.emptySlotButton,
                                  styles.emptySlotButtonMerge,
                                  styles.emptySlotUnavailable,
                                )}
                                role="img"
                                aria-label={mergeCandidate.overflowMessage}
                                title={mergeCandidate.overflowMessage}
                              >
                                <span className={styles.emptyCircle} aria-hidden />
                              </span>
                            );
                          }
                          if (canTakeSlot) {
                            return (
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
                            );
                          }
                          if (canReserve) {
                            return (
                              <span
                                className={cn(styles.emptySlot, styles.emptySlotUnavailable)}
                                aria-label={
                                  isAuthenticated
                                    ? "空き。初期設定が未完了です"
                                    : "空き。ログインが必要です"
                                }
                                title={
                                  isAuthenticated
                                    ? "利用規約同意または X ID 申請が必要です"
                                    : "ログインが必要です"
                                }
                              >
                                <span className={styles.emptyCircle} aria-hidden />
                              </span>
                            );
                          }
                          return (
                            <span
                              className={cn(styles.emptySlot, styles.emptySlotUnavailable)}
                              aria-label="空き"
                              title="空き"
                            >
                              <span className={styles.emptyCircle} aria-hidden />
                            </span>
                          );
                        })()}
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
        message={
          releaseTargetSlot?.is_group ? (
            <>
              <p>
                {releaseTargetSlot.start_time
                  ? formatUnix(releaseTargetSlot.start_time, { timeOnly: true })
                  : (releaseTargetSlot.slot_label ??
                    `#${releaseTargetSlot.sort_order ?? "?"}`)}{" "}
                の枠を解放しますか？
              </p>
              <p>
                この枠は連続{releaseTargetSlot.group_size}枠の
                {releaseTargetSlot.group_position}枠目です。
                解放後は必要に応じて前後の枠が別の連続枠に分かれます。
              </p>
            </>
          ) : (
            "この枠を解放します。よろしいですか?"
          )
        }
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
            {eventMaxSlots > 1 ? (
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
                    { length: Math.max(1, reserveMaxCount) },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "単枠で確保" : `${n}枠連続で確保`}
                    </option>
                  ))}
                </select>
                <p className={styles.reserveDialogHint}>
                  連続枠は空きが隣接している場合だけまとめて確保されます。上限は {eventMaxSlots} 枠です。
                </p>
                {Number(reserveCount) >= 2 && reservePreviewSlots.length >= 2 ? (
                  Number(reserveCount) >= 4 ? (
                    <p className={styles.reserveDialogHint}>
                      取得予定 {formatSlotLabel(reservePreviewSlots[0])} … · {reserveCount}枠
                    </p>
                  ) : (
                    <p className={styles.reserveDialogHint}>
                      取得予定:{" "}
                      {reservePreviewSlots.map((slot) => formatSlotLabel(slot)).join("、")}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
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
