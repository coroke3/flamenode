"use client";

import * as React from "react";

interface Props {
  before: string | null;
  after: string | null;
  changedKeys: string[];
}

function shorten(v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "string") {
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return String(v);
  }
}

export function AuditDiffDetail({
  before,
  after,
  changedKeys,
}: Props): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);

  const beforeObj = React.useMemo(() => {
    try {
      return before ? (JSON.parse(before) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [before]);

  const afterObj = React.useMemo(() => {
    try {
      return after ? (JSON.parse(after) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [after]);

  if (changedKeys.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => setOpen((o) => !o)}
        style={{ marginLeft: 6, padding: "0 6px", height: 22, fontSize: 11 }}
        aria-expanded={open}
      >
        {open ? "閉じる" : "差分"}
      </button>
      {open ? (
        <div
          style={{
            marginTop: 6,
            padding: 8,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            display: "grid",
            gap: 4,
          }}
        >
          {changedKeys.map((k) => (
            <div
              key={k}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr 1fr",
                gap: 6,
                alignItems: "baseline",
                fontFamily: "monospace",
              }}
            >
              <strong style={{ color: "var(--text-primary)" }}>{k}</strong>
              <span style={{ color: "var(--accent-danger)", wordBreak: "break-all" }}>
                {shorten(beforeObj[k])}
              </span>
              <span style={{ color: "var(--accent-primary)", wordBreak: "break-all" }}>
                {shorten(afterObj[k])}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            <span style={{ color: "var(--accent-danger)" }}>赤 = before</span>
            {" / "}
            <span style={{ color: "var(--accent-primary)" }}>緑 = after</span>
            。値が長い場合は 120 文字で省略。
          </div>
        </div>
      ) : null}
    </>
  );
}
