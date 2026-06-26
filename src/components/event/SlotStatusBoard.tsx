import * as React from "react";
import type { SlotRow } from "./SlotGrid";
import { buildSlotParts, formatSlotPartLabel } from "@/lib/utils/slotGrouping";
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

export function SlotStatusBoard({
  slots,
  slotPartGapSec,
  eventTitle,
  slotFormatLabel,
  deadlineLabel,
}: SlotStatusBoardProps): React.ReactElement {
  const partitioned = React.useMemo(() => {
    if (slots.length === 0) return [] as PartStat[];
    return buildSlotParts(slots, slotPartGapSec).map((part) => ({
      label: formatSlotPartLabel(part, "short"),
      total: part.rows.length,
      filled: part.rows.filter((s) => s.status !== "available").length,
    }));
  }, [slots, slotPartGapSec]);

  const total = slots.length;
  const filled = slots.filter((s) => s.status !== "available").length;
  if (total === 0) return <></>;

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
  const fillPct = pct(filled, total);
  const nextAvailable = slots.find((slot) => slot.status === "available");
  const selected = nextAvailable ?? slots[0];
  const selectedTime =
    selected?.start_time != null
      ? formatUnix(selected.start_time, { timeOnly: true })
      : (selected?.slot_label ?? "-");
  const selectedDate =
    selected?.start_time != null
      ? formatUnix(selected.start_time, { dateOnly: true })
      : null;
  const selectedStatus = nextAvailable ? "確保できます" : "空き枠なし";

  return (
    <section className={styles.board} aria-label="枠の状態">
      <p className={styles.eyebrow}>{nextAvailable ? "次の空き枠" : "受付状況"}</p>
      <div className={styles.selected}>
        <strong>{selectedTime}</strong>
        {selectedDate ? <span>{selectedDate}</span> : null}
        <small>{selectedStatus}</small>
      </div>

      <div className={styles.summary} aria-label="埋まり状況">
        <div className={styles.summaryHead}>
          <span>埋まり枠</span>
          <strong>
            {filled}
            <small> / {total}</small>
          </strong>
        </div>
        <span className={styles.summaryBar} aria-hidden>
          <span
            className={styles.summaryBarFill}
            style={{ width: `${fillPct}%` }}
          />
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
        {partitioned.map((p, i) => (
          <div key={i} className={styles.partRow}>
            <span>{p.label}</span>
            <strong>
              {p.filled}
              <small> / {p.total}</small>
            </strong>
            <em>{pct(p.filled, p.total)}%</em>
            <i className={styles.partMeter} aria-hidden>
              <b style={{ width: `${pct(p.filled, p.total)}%` }} />
            </i>
          </div>
        ))}
      </div>
    </section>
  );
}
