import * as React from "react";
import { Link } from "react-router-dom";
import type { ManageSlotRow } from "@flamenode/contracts";
import { partLabels } from "./slotParts.js";

const STATUS_LABELS = Object.freeze({
  available: "空き",
  reserved: "確保済",
  submitted: "提出済",
});
const TOKYO_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function slotStatusLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)
    ? STATUS_LABELS[value as keyof typeof STATUS_LABELS] : "不明";
}
export function slotTimeLabel(row: ManageSlotRow): string {
  return row.start_time !== null
    ? TOKYO_TIME.format(new Date(row.start_time * 1000))
    : (row.slot_label ?? "—");
}

/** MIG-0722 U02a: CURRENT SlotList read fields; U02b mutations are deliberately absent. */
export function SlotList({ eventId, slots, partGapMinutes, parts }: {
  eventId: string; slots: readonly ManageSlotRow[];
  partGapMinutes: number | null; parts: readonly string[];
}): React.ReactElement {
  const labels = React.useMemo(() => partLabels(slots, partGapMinutes, parts), [
    slots, partGapMinutes, parts,
  ]);
  if (slots.length === 0) return <p className="fn-muted fn-text-sm">枠はまだありません。</p>;
  return <div className="manage-slot-list">
    <p className="fn-console-note" role="status">
      枠の状態と取得者を表示しています。編集・削除機能は移行中です。
    </p>
    <div className="fn-table-scroll" role="region" aria-label="枠一覧（横スクロール可能）" tabIndex={0}
      style={{ maxWidth: "100%", overflowX: "auto" }}>
      <table className="fn-table manage-slot-table">
        <thead><tr>
          <th scope="col">日時 / 部</th><th scope="col">取得者</th>
          <th scope="col">状態</th><th scope="col">作品</th>
        </tr></thead>
        <tbody>{slots.map(slot => (
          <tr key={slot.id}>
            <td className="manage-slot-datetime">
              <span className="manage-slot-datetime-main">{slotTimeLabel(slot)}</span>
              <span className="manage-slot-datetime-part">{labels.get(slot.id) ?? "—"}</span>
            </td>
            <td className="manage-slot-holder">
              {slot.display_name || slot.reserved_x_id_snapshot || slot.x_user_id ||
              slot.discord_display_name || slot.discord_id ? (
                <div className="manage-slot-holder-grid">
                  <div><span className="fn-muted">名義: </span>{slot.display_name ?? "記録なし"}</div>
                  <div><span className="fn-muted">X ID: </span>
                    {slot.reserved_x_id_snapshot ? `@${slot.reserved_x_id_snapshot}`
                      : slot.x_user_id ? `@${slot.x_user_id}` : "記録なし"}</div>
                  <div><span className="fn-muted">Discord: </span>
                    {slot.discord_display_name ?? "記録なし"}</div>
                  <div><span className="fn-muted">Discord ID: </span>
                    {slot.discord_id ?? "記録なし"}</div>
                </div>
              ) : "—"}
            </td>
            <td><span className={"fn-badge " + (
              slot.status === "available" ? "fn-badge-soft"
                : slot.status === "reserved" ? "fn-badge-warning"
                : "fn-badge-accent"
            )}>{slotStatusLabel(slot.status)}</span></td>
            <td>{slot.video_id
              ? <Link to={`/manage/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(slot.video_id)}`}>
                  作品を見る
                </Link> : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </div>;
}
