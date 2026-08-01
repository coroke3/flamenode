"use client";

import * as React from "react";
import Link from "next/link";
import type { EventExportUpdateMode } from "@/lib/api/eventExportPayload";

interface EventExportLinkBuilderProps {
  eventId: string;
}

export function EventExportLinkBuilder({
  eventId,
}: EventExportLinkBuilderProps): React.ReactElement {
  const [updateMode, setUpdateMode] =
    React.useState<EventExportUpdateMode>("realtime");
  const [refreshMinutes, setRefreshMinutes] = React.useState("60");
  const [copied, setCopied] = React.useState(false);

  const href = React.useMemo(() => {
    const params = new URLSearchParams({ update: updateMode });
    if (updateMode === "scheduled") params.set("refresh", refreshMinutes);
    return `/api/event-endpoints/${encodeURIComponent(eventId)}?${params.toString()}`;
  }, [eventId, refreshMinutes, updateMode]);

  async function copyUrl(): Promise<void> {
    const absoluteUrl = new URL(href, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 280 }}>
      <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
        出力形式はFlameNodeイベントAPI v5に統一されています。
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <label className="fn-field" style={{ minWidth: 150 }}>
          <span className="fn-label">更新方式</span>
          <select
            className="fn-select"
            value={updateMode}
            onChange={(event) =>
              setUpdateMode(event.target.value as EventExportUpdateMode)
            }
          >
            <option value="realtime">リアルタイム</option>
            <option value="scheduled">節約定期更新</option>
          </select>
        </label>

        {updateMode === "scheduled" ? (
          <label className="fn-field" style={{ minWidth: 120 }}>
            <span className="fn-label">更新間隔</span>
            <select
              className="fn-select"
              value={refreshMinutes}
              onChange={(event) => setRefreshMinutes(event.target.value)}
            >
              <option value="15">15分</option>
              <option value="60">1時間</option>
              <option value="360">6時間</option>
              <option value="1440">24時間</option>
            </select>
          </label>
        ) : null}
      </div>

      <code
        style={{
          display: "block",
          padding: "8px 10px",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-inset)",
          border: "1px solid var(--border-subtle)",
          overflowWrap: "anywhere",
          fontSize: 11,
        }}
      >
        {href}
      </code>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-sm fn-btn-primary"
          onClick={copyUrl}
        >
          {copied ? "コピー済み" : "URLをコピー"}
        </button>
        <Link
          className="fn-btn fn-btn-sm fn-btn-ghost"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          出力を確認
        </Link>
      </div>
    </div>
  );
}
