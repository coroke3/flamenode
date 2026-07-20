import * as React from "react";
import type { notificationOutbox } from "@/lib/db/schema";
import {
  formatNotificationRowTitle,
  getNotificationFailureGuidance,
  getNotificationStatusLabel,
  severityBadgeClass,
  statusBadgeClass,
  summarizeNotificationPayload,
} from "@/lib/notifications/display";
import { isTerminalNotificationFailure } from "@/lib/notifications/status";
import {
  formatRecipientDisplay,
  type RecipientLookup,
} from "@/lib/notifications/recipient";


type Row = typeof notificationOutbox.$inferSelect;

interface Props {
  row: Row;
  recipient?: RecipientLookup | null;
  /** manage では操作ボタンを出さない。 */
  showTechnicalType?: boolean;
}

export function NotificationOutboxSummary({
  row,
  recipient,
  showTechnicalType = false,
}: Props): React.ReactElement {
  const meta = formatNotificationRowTitle(row.type);
  const payload = summarizeNotificationPayload(row.payload_json);
  const guidance = getNotificationFailureGuidance({
    status: row.status,
    lastError: row.last_error,
    attemptCount: row.attempt_count,
  });
  const terminalFailure = isTerminalNotificationFailure(row.status);
  const showGuidance =
    guidance != null &&
    (terminalFailure || row.status === "processing" || row.status === "cancelled");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span className={`fn-badge ${statusBadgeClass(row.status)}`}>
          {getNotificationStatusLabel(row.status)}
        </span>
        <span className={`fn-badge ${severityBadgeClass(meta.severity)}`}>
          {meta.categoryLabel}
        </span>
        <strong style={{ fontSize: 13 }}>{meta.label}</strong>
        {showTechnicalType ? (
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
            {row.type}
          </span>
        ) : null}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        宛先: {formatRecipientDisplay(row.recipient_user_id, recipient)}
        {recipient?.notificationsEnabled === false ? (
          <span style={{ marginLeft: 6, color: "var(--accent-warning)" }}>
            （通知OFF）
          </span>
        ) : null}
      </div>

      {payload.preview !== "—" ? (
        <div style={{ fontSize: 12, lineHeight: 1.45 }}>{payload.preview}</div>
      ) : null}

      {row.dedupe_key ? (
        <div style={{ fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>
          重複防止キー: {row.dedupe_key}
        </div>
      ) : null}

      {showGuidance ? (
        <div
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-md)",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600 }}>{guidance.summary}</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {guidance.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.last_error && (terminalFailure || row.status === "cancelled") ? (
        <div
          style={{
            fontSize: 10,
            color: terminalFailure ? "var(--accent-danger)" : "var(--text-muted)",
            wordBreak: "break-all",
          }}
        >
          {row.last_error}
        </div>
      ) : null}
    </div>
  );
}
