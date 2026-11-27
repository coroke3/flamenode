// MIG-0721 U02d: CURRENT SA-024 delete confirmation form with injected ports.
// No default write client or route registration; the protected host remains unmounted.
import * as React from "react";
import type { EventFormProps } from "../../components/event/EventForm.js";
import { Icon } from "../../components/shared/Icon.js";

export type EventDeleteImpact = {
  slotsTotal: number;
  reservedSlots: number;
  submittedSlots: number;
  linkedVideos: number;
  staffCount: number;
  apiEndpointCount: number;
} | null;

export function DeleteEventForm({
  eventId,
  redirectHref = "/admin/events",
  impact,
  deleteEvent,
  onNavigate,
}: {
  eventId: string;
  redirectHref?: string;
  impact?: EventDeleteImpact;
  deleteEvent: EventFormProps["updateEvent"];
  onNavigate: (href: string) => void;
}): React.ReactElement {
  const [confirm, setConfirm] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirm !== eventId) {
      setError("イベント ID と完全一致する文字列を入力してください。");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("event_id", eventId);
    formData.set("confirm", confirm);
    startTransition(async () => {
      const result = await deleteEvent(formData);
      if (!result.ok) {
        setError(result.message ?? "非公開化に失敗しました。");
        return;
      }
      onNavigate(redirectHref);
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}
    >
      {impact ? (
        <div
          style={{
            padding: "10px 12px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: 12,
            lineHeight: 1.6,
            background: "var(--bg-surface)",
          }}
        >
          <strong style={{ fontSize: 13 }}>影響範囲:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            <li>枠: {impact.slotsTotal}件 (予約済み: {impact.reservedSlots}, 提出済み: {impact.submittedSlots})</li>
            <li>紐づく作品: {impact.linkedVideos}件</li>
            <li>スタッフ: {impact.staffCount}人</li>
            {impact.apiEndpointCount > 0 ? (
              <li>公開API設定: {impact.apiEndpointCount}件</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <label className="fn-label">
        確認のためイベント ID <code>{eventId}</code> を入力
      </label>
      <input
        type="text"
        className="fn-input"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        placeholder={eventId}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} /> {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy || confirm !== eventId}
      >
        <Icon name="trash" size={12} />
        {busy ? "非公開化中…" : "イベントを非公開にする"}
      </button>
    </form>
  );
}
