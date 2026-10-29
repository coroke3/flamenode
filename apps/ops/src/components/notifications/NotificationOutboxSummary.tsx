import * as React from "react";
import type { ManageNotificationRow } from "@flamenode/contracts";
// Read-only projection. No technical delivery action may be invoked from Manage.
const STATUS: Record<string, string> = { pending: "配信待ち", processing: "送信中", sent: "送信済み", failed: "失敗", dead_letter: "最終失敗", cancelled: "キャンセル" };
export function summarizePayload(json: string): string {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
    const content = (value as Record<string, unknown>).content;
    if (typeof content !== "string") return "—";
    const first = content.trim().split("\n").find(Boolean) ?? "";
    return first.length > 80 ? first.slice(0, 80) + "…" : first || "—";
  } catch { return "—"; }
}
export function NotificationOutboxSummary({ row }: { row: ManageNotificationRow }): React.ReactElement {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span className={"fn-badge " + (row.status === "failed" || row.status === "dead_letter" ? "fn-badge-danger" : row.status === "processing" ? "fn-badge-warning" : "fn-badge-soft")}>{STATUS[row.status ?? ""] ?? row.status ?? "不明"}</span>
      <strong style={{ fontSize: 13 }}>{row.type}</strong>
    </div>
    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>宛先: {row.recipient_user_id || "—"}</div>
    {summarizePayload(row.payload_json) !== "—" ? <div style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{summarizePayload(row.payload_json)}</div> : null}
    {row.last_error && (row.status === "failed" || row.status === "dead_letter" || row.status === "cancelled") ? <div style={{ fontSize: 11, wordBreak: "break-all" }}>{row.last_error}</div> : null}
  </div>;
}
