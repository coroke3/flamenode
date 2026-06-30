"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { deleteEvent } from "@/lib/actions/event-admin";

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
}: {
  eventId: string;
  redirectHref?: string;
  impact?: EventDeleteImpact;
}): React.ReactElement {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm !== eventId) {
      setError("イベント ID と完全一致する文字列を入力してください。");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("confirm", confirm);
    startTransition(async () => {
      const r = await deleteEvent(fd);
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      router.push(redirectHref);
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
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={eventId}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy || confirm !== eventId}
      >
        <Icon name="trash" size={12} aria-hidden />
        {busy ? "削除中…" : "イベントを削除"}
      </button>
    </form>
  );
}
