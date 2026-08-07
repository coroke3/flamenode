"use client";

import * as React from "react";
import type { SlotRow } from "./SlotGrid";
import { buildSlotParts, formatSlotPartLabel, sortSlotsChronologically } from "@/lib/utils/slotGrouping";
import { formatUnix } from "@/lib/utils/format";
import styles from "./SlotStatusBoard.module.css";

interface SlotStatusBoardProps {
  slots: SlotRow[];
  slotPartGapSec?: number;
  eventTitle?: string;
  slotFormatLabel?: string;
  deadlineLabel?: string | null;
}

interface PartStat {
  label: string;
  total: number;
  filled: number;
}

const SLOT_PREVIEW_EVENT = "flamenode:slot-preview";
type SlotStatus = SlotRow["status"];

function statusLabel(status: SlotStatus): string {
  switch (status) {
    case "submitted":
      return "提出済み";
    case "reserved":
      return "確保済み";
    case "available":
    default:
      return "空き枠";
  }
}

function statusHint(status: SlotStatus): string {
  switch (status) {
    case "submitted":
      return "作品が提出されています";
    case "reserved":
      return "確保されています";
    case "available":
    default:
      return "確保できます";
  }
}

function slotOwnerLabel(slot: SlotRow | null): string | null {
  const displayName = slot?.display_name?.trim();
  return displayName || null;
}

function slotTimeLabel(slot: SlotRow | null): string {
  if (!slot) return "-";
  if (slot.start_time != null) {
    return formatUnix(slot.start_time, { timeOnly: true });
  }
  return slot.slot_label ?? `#${slot.sort_order ?? "?"}`;
}

function slotDateLabel(slot: SlotRow | null): string | null {
  if (slot?.start_time == null) return null;
  return formatUnix(slot.start_time, { dateOnly: true });
}

export function SlotStatusBoard({
  slots,
  slotPartGapSec,
  eventTitle,
  slotFormatLabel,
  deadlineLabel,
}: SlotStatusBoardProps): React.ReactElement {
  const [selectedSlotId, setSelectedSlotId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleSlotPreview = (event: Event) => {
      const slotId = (event as CustomEvent<{ slotId?: string }>).detail?.slotId;
      if (slotId) setSelectedSlotId(slotId);
    };
    window.addEventListener(SLOT_PREVIEW_EVENT, handleSlotPreview);
    return () => window.removeEventListener(SLOT_PREVIEW_EVENT, handleSlotPreview);
  }, []);

  React.useEffect(() => {
    if (selectedSlotId && !slots.some((slot) => slot.id === selectedSlotId)) {
      setSelectedSlotId(null);
    }
  }, [selectedSlotId, slots]);

  const partitioned = React.useMemo(() => {
    if (slots.length === 0) return [] as PartStat[];
    return buildSlotParts(slots, slotPartGapSec).map((part) => ({
      label: formatSlotPartLabel(part, "short"),
      total: part.rows.length,
      filled: part.rows.filter((slot) => slot.status !== "available").length,
    }));
  }, [slots, slotPartGapSec]);

  const total = slots.length;
  const filled = slots.filter((slot) => slot.status !== "available").length;
  const nextAvailable = slots.find((slot) => slot.status === "available");
  const manuallySelected = selectedSlotId
    ? slots.find((slot) => slot.id === selectedSlotId)
    : null;
  const selected = manuallySelected ?? nextAvailable ?? slots[0] ?? null;
  const selectedGroupInfo = React.useMemo(() => {
    if (!selected?.group_key) return null;
    const groupSlots = sortSlotsChronologically(
      slots.filter((slot) => slot.group_key === selected.group_key),
    );
    const position = groupSlots.findIndex((slot) => slot.id === selected.id) + 1;
    if (position < 1) return null;
    return { position, size: groupSlots.length };
  }, [selected, slots]);

  if (total === 0) return <></>;

  const pct = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
  const fillPct = pct(filled, total);
  const selectedOwner = slotOwnerLabel(selected);
  const selectedTime = slotTimeLabel(selected);
  const selectedDate = slotDateLabel(selected);

  return (
    <section className={styles.board} aria-label="枠の状態">
      <p className={styles.eyebrow}>
        {manuallySelected ? "選択中の枠" : nextAvailable ? "次の空き枠" : "受付状況"}
      </p>
      <div
        className={styles.selected}
        data-status={selected?.status ?? "available"}
        aria-live="polite"
      >
        <strong>{selectedTime}</strong>
        {selectedDate ? <span>{selectedDate}</span> : null}
        <small>{statusHint(selected?.status ?? "available")}</small>
      </div>

      <dl className={styles.slotDetails} aria-label="選択中の枠の詳細">
        <div>
          <dt>状態</dt>
          <dd>{statusLabel(selected?.status ?? "available")}</dd>
        </div>
        <div>
          <dt>時刻</dt>
          <dd>{selectedTime}</dd>
        </div>
        {selectedOwner ? (
          <div>
            <dt>名義</dt>
            <dd>{selectedOwner}</dd>
          </div>
        ) : null}
        {selectedGroupInfo ? (
          <div>
            <dt>連続枠</dt>
            <dd>
              {selectedGroupInfo.position}枠目 / 全{selectedGroupInfo.size}枠
            </dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.summary} aria-label="埋まり状況">
        <div className={styles.summaryHead}>
          <span>埋まり枠</span>
          <strong>
            {filled}
            <small> / {total}</small>
          </strong>
        </div>
        <span className={styles.summaryBar} aria-hidden>
          <span className={styles.summaryBarFill} style={{ width: `${fillPct}%` }} />
        </span>
        <p>{fillPct}% 埋まり</p>
      </div>

      <dl className={styles.details}>
        {eventTitle ? (
          <div>
            <dt>イベント</dt>
            <dd>{eventTitle}</dd>
          </div>
        ) : null}
        {slotFormatLabel ? (
          <div>
            <dt>形式</dt>
            <dd>{slotFormatLabel}</dd>
          </div>
        ) : null}
        {deadlineLabel ? (
          <div>
            <dt>提出締切</dt>
            <dd>{deadlineLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>埋まり枠</dt>
          <dd>
            {filled} / {total}
          </dd>
        </div>
      </dl>

      <div className={styles.actionHint}>
        枠確保後、投稿期間内に作品を提出してください。未提出の枠は自動解放されます。
      </div>

      <div className={styles.parts}>
        {partitioned.map((part) => (
          <div key={part.label} className={styles.partRow}>
            <span>{part.label}</span>
            <strong>
              {part.filled}
              <small> / {part.total}</small>
            </strong>
            <em>{pct(part.filled, part.total)}%</em>
            <i className={styles.partMeter} aria-hidden>
              <b style={{ width: `${pct(part.filled, part.total)}%` }} />
            </i>
          </div>
        ))}
      </div>
    </section>
  );
}
