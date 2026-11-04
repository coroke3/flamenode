import * as React from "react";
import type { ManageNotificationRow } from "@flamenode/contracts";
import { isTerminalNotificationFailure } from "@flamenode/domain/admin";
import {
  formatNotificationRowTitle,
  getNotificationFailureGuidance,
  getNotificationStatusLabel,
  notificationDeliveryRouteLabel,
  severityBadgeClass,
  statusBadgeClass,
  summarizeNotificationPayload,
  translateNotificationError,
} from "./notificationDisplay.js";

// Read-only projection (CURRENT src/components/notifications/NotificationOutboxSummary.tsx).
// No technical delivery action may be invoked from Manage.
export interface RecipientLookup { userId: string; discordId: string | null; userName: string | null; notificationsEnabled: boolean | null }
export function formatRecipientDisplay(userId: string | null, lookup?: RecipientLookup | null): string {
  if (lookup?.userName) return lookup.discordId ? lookup.userName + " (" + lookup.discordId + ")" : lookup.userName;
  return lookup?.discordId ?? userId ?? "運営チャンネル";
}
export type NotificationSummaryRow = Pick<ManageNotificationRow, "type" | "status" | "payload_json" | "attempt_count" | "last_error" | "dedupe_key" | "recipient_user_id">;
export function NotificationOutboxSummary({ row, recipient, showTechnicalType = false }: {
  row: NotificationSummaryRow; recipient?: RecipientLookup | null; showTechnicalType?: boolean;
}): React.ReactElement {
  const meta = formatNotificationRowTitle(row.type);
  const payload = summarizeNotificationPayload(row.payload_json);
  const guidance = getNotificationFailureGuidance({ status: row.status, lastError: row.last_error, attemptCount: row.attempt_count });
  const terminalFailure = isTerminalNotificationFailure(row.status);
  const showGuidance = guidance != null && (terminalFailure || row.status === "processing" || row.status === "cancelled");
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span className={"fn-badge " + statusBadgeClass(row.status)}>{getNotificationStatusLabel(row.status)}</span>
      {showTechnicalType ? <span className="fn-badge fn-badge-soft" title="配送経路">{notificationDeliveryRouteLabel(row.type)}</span> : null}
      <span className={"fn-badge " + severityBadgeClass(meta.severity)}>{meta.categoryLabel}</span>
      <strong style={{ fontSize: 13 }}>{meta.label}</strong>
      {showTechnicalType ? <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>{row.type}</span> : null}
    </div>
    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
      宛先: {formatRecipientDisplay(row.recipient_user_id, recipient)}
      {recipient?.discordId ? <span style={{ marginLeft: 6, fontFamily: "monospace" }}>discord_id: {recipient.discordId}</span>
        : showTechnicalType ? <span style={{ marginLeft: 6, color: "var(--accent-warning)" }}>discord_id 未連携</span> : null}
      {recipient?.notificationsEnabled === false ? <span style={{ marginLeft: 6, color: "var(--accent-warning)" }}>（通知OFF）</span> : null}
    </div>
    {payload.fullContent !== "—" ? <div style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{showTechnicalType ? payload.fullContent : payload.preview}</div> : null}
    {showTechnicalType && row.dedupe_key ? <div style={{ fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>重複防止キー: {row.dedupe_key}</div> : null}
    {showGuidance ? <div style={{ marginTop: 4, padding: "8px 10px", background: "var(--bg-surface)", borderRadius: "var(--radius-md)", fontSize: 11, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 600 }}>{guidance.summary}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{guidance.nextSteps.map(step => <li key={step}>{step}</li>)}</ul>
    </div> : null}
    {row.last_error && (terminalFailure || row.status === "cancelled") ? <div style={{ fontSize: 10, color: terminalFailure ? "var(--accent-danger)" : "var(--text-muted)", wordBreak: "break-all" }}>{translateNotificationError(row.last_error) ?? row.last_error}</div> : null}
  </div>;
}
