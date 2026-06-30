"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addEventsToGroup,
  removeEventFromGroup,
} from "@/lib/actions/event-group-admin";
import { formatUnix } from "@/lib/utils/format";

export interface EventGroupMemberRow {
  event_id: string;
  title: string;
  start_time: number | null;
}

export interface EventOption {
  id: string;
  title: string;
  start_time?: number | null;
}

interface Props {
  groupId: string;
  members: EventGroupMemberRow[];
  eventOptions: EventOption[];
}

export function EventGroupMembersEditor({
  groupId,
  members,
  eventOptions,
}: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const memberIds = new Set(members.map((m) => m.event_id));
  const availableEvents = eventOptions.filter((e) => !memberIds.has(e.id));

  const toggleSelected = (eventId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const onAddSelected = () => {
    if (selectedIds.size === 0) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await addEventsToGroup({
        groupId,
        eventIds: [...selectedIds],
      });
      if (!r.ok) {
        setError(r.message ?? "追加に失敗しました。");
        return;
      }
      setSelectedIds(new Set());
      setMessage(`${r.added ?? selectedIds.size} 件を追加しました。`);
      router.refresh();
    });
  };

  const onRemove = (eventId: string) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await removeEventFromGroup({ groupId, eventId });
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {availableEvents.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span className="fn-label" style={{ margin: 0 }}>
              イベントを選択して追加
            </span>
            <button
              type="button"
              className="fn-btn fn-btn-primary fn-btn-sm"
              onClick={onAddSelected}
              disabled={busy || selectedIds.size === 0}
            >
              {selectedIds.size > 0
                ? `${selectedIds.size} 件を追加`
                : "選択を追加"}
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 280,
              overflowY: "auto",
              padding: "8px 10px",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {availableEvents.map((e) => (
              <label
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "6px 4px",
                  fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(e.id)}
                  onChange={() => toggleSelected(e.id)}
                  disabled={busy}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{e.title}</span>
                  {e.start_time ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {formatUnix(e.start_time, { dateOnly: true })}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="fn-muted" style={{ fontSize: 13, margin: 0 }}>
          追加できるイベントはありません。
        </p>
      )}

      {error ? (
        <p style={{ color: "var(--accent-danger)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p style={{ color: "var(--accent-success)", fontSize: 13, margin: 0 }}>
          {message}
        </p>
      ) : null}

      {members.length === 0 ? (
        <p className="fn-muted" style={{ fontSize: 13, margin: 0 }}>
          所属イベントはまだありません。
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {members.map((m) => (
            <div
              key={m.event_id}
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                padding: "10px 12px",
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <Link
                  href={`/admin/events/${m.event_id}`}
                  style={{ fontWeight: 600, fontSize: 13 }}
                >
                  {m.title}
                </Link>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {m.start_time
                    ? formatUnix(m.start_time, { dateOnly: true })
                    : "日時未設定"}
                </div>
              </div>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => onRemove(m.event_id)}
                disabled={busy}
              >
                外す
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
