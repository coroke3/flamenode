import * as React from "react";
import type { SlotRow } from "./SlotGrid";

interface SlotStatusBoardProps {
  slots: SlotRow[];
}

interface PartStat {
  label: string;
  total: number;
  filled: number;
}

/**
 * 設計画像の「残枠状況」サイドバー。部別 + 合計を表示する。
 */
export function SlotStatusBoard({
  slots,
}: SlotStatusBoardProps): React.ReactElement {
  // 30 分以上空白で部分割 (SlotGrid.partitionByPart と整合)
  const partitioned = React.useMemo(() => {
    if (slots.length === 0) return [] as PartStat[];
    const sorted = [...slots]
      .filter((r) => r.start_time != null)
      .sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
    const rest = slots.filter((r) => r.start_time == null);
    const groups: PartStat[] = [];
    let current: SlotRow[] = [];
    let prevEnd = 0;
    const GAP = 30 * 60;
    for (const r of sorted) {
      if (current.length === 0 || (r.start_time ?? 0) - prevEnd > GAP) {
        if (current.length > 0)
          groups.push({
            label: "",
            total: current.length,
            filled: current.filter((s) => s.status !== "available").length,
          });
        current = [];
      }
      current.push(r);
      prevEnd = r.end_time ?? r.start_time ?? prevEnd;
    }
    if (current.length > 0)
      groups.push({
        label: "",
        total: current.length,
        filled: current.filter((s) => s.status !== "available").length,
      });
    if (rest.length > 0) {
      groups.push({
        label: "時間なし枠",
        total: rest.length,
        filled: rest.filter((s) => s.status !== "available").length,
      });
    }
    groups.forEach((g, i) => {
      if (!g.label) g.label = `第${i + 1}部`;
    });
    return groups;
  }, [slots]);

  const total = slots.length;
  const filled = slots.filter((s) => s.status !== "available").length;
  if (total === 0) return <></>;

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

  return (
    <section
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "10px 14px",
          background: "var(--bg-elevated)",
          fontSize: 13,
          fontWeight: 700,
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
