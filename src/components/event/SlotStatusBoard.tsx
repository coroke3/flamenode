import * as React from "react";
import type { SlotRow } from "./SlotGrid";
import { buildSlotParts, formatSlotPartLabel } from "@/lib/utils/slotGrouping";

interface SlotStatusBoardProps {
  slots: SlotRow[];
  /** 「部」分割閾値 (秒)。未指定で 30 分。 */
  slotPartGapSec?: number;
}

interface PartStat {
  label: string;
  total: number;
  filled: number;
}

/** 予約枠の埋まり具合を部別 + 合計で表示する。 */
export function SlotStatusBoard({
  slots,
  slotPartGapSec,
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

  return (
    <section
      style={{
        display: "grid",
        gap: 10,
      }}
    >
      <header
        style={{
          padding: 0,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        残枠状況
      </header>
      <table className="fn-table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>部</th>
            <th>済 / 枠数</th>
            <th>済率</th>
            <th>残り</th>
          </tr>
        </thead>
        <tbody>
          {partitioned.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td>
                {p.filled} / {p.total}
              </td>
              <td>{pct(p.filled, p.total)}%</td>
              <td>
                {p.total - p.filled === 0 ? (
                  <span className="fn-badge fn-badge-neutral">残り 0 枠</span>
                ) : (
                  `残り ${p.total - p.filled} 枠`
                )}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "var(--bg-elevated)" }}>
            <td>合計</td>
            <td>
              {filled} / {total}
            </td>
            <td>{pct(filled, total)}%</td>
            <td>残り {total - filled} 枠</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
