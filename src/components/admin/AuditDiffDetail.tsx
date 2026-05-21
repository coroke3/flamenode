"use client";

import * as React from "react";

interface Props {
  before: string | null;
  after: string | null;
  changedKeys: string[];
}

const SUMMARY_LIMIT = 120;

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function shorten(text: string, limit = SUMMARY_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

interface CellProps {
  value: unknown;
  tone: "before" | "after";
}

function DiffCell({ value, tone }: CellProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const text = valueToString(value);
  const isLong = text.length > SUMMARY_LIMIT;
  const color =
    tone === "before" ? "var(--accent-danger)" : "var(--accent-primary)";
  if (!isLong) {
    return (
      <span
        style={{
          color,
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </span>
    );
  }
  return (
    <span style={{ color, wordBreak: "break-all" }}>
      {expanded ? (
        <pre
          style={{
            margin: 0,
            padding: "4px 6px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            maxHeight: 240,
            overflow: "auto",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            color,
          }}
        >
          {text}
        </pre>
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{shorten(text)}</span>
      )}
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginLeft: 4,
          padding: "0 4px",
          height: 18,
          fontSize: 10,
        }}
      >
        {expanded ? "折りたたむ" : `全文 (${text.length}文字)`}
      </button>
    </span>
  );
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
          }}
        >
          <div
            role="table"
            aria-label="変更差分"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(80px, auto) 1fr 1fr",
              gap: 0,
              fontFamily: "monospace",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
            }}
          >
            <span
              role="columnheader"
              style={{
                padding: "4px 8px",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--bg-surface)",
                color: "var(--text-muted)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              キー
            </span>
            <span
              role="columnheader"
              style={{
                padding: "4px 8px",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--bg-surface)",
                color: "var(--accent-danger)",
                borderBottom: "1px solid var(--border-subtle)",
                borderLeft: "1px solid var(--border-subtle)",
              }}
            >
              before
            </span>
            <span
              role="columnheader"
              style={{
                padding: "4px 8px",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--bg-surface)",
                color: "var(--accent-primary)",
                borderBottom: "1px solid var(--border-subtle)",
                borderLeft: "1px solid var(--border-subtle)",
              }}
            >
              after
            </span>
            {changedKeys.map((k, i) => (
              <React.Fragment key={k}>
                <span
                  role="cell"
                  style={{
                    padding: "4px 8px",
                    borderTop:
                      i === 0 ? "0" : "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    fontWeight: 700,
                  }}
                >
                  {k}
                </span>
                <span
                  role="cell"
                  style={{
                    padding: "4px 8px",
                    borderTop:
                      i === 0 ? "0" : "1px solid var(--border-subtle)",
                    borderLeft: "1px solid var(--border-subtle)",
                  }}
                >
                  <DiffCell value={beforeObj[k]} tone="before" />
                </span>
                <span
                  role="cell"
                  style={{
                    padding: "4px 8px",
                    borderTop:
                      i === 0 ? "0" : "1px solid var(--border-subtle)",
                    borderLeft: "1px solid var(--border-subtle)",
                  }}
                >
                  <DiffCell value={afterObj[k]} tone="after" />
                </span>
              </React.Fragment>
            ))}
          </div>
          <div
            style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}
          >
            <span style={{ color: "var(--accent-danger)" }}>赤 = before</span>
            {" / "}
            <span style={{ color: "var(--accent-primary)" }}>緑 = after</span>
            。長い値は省略表示し「全文」で展開できます。
          </div>
        </div>
      ) : null}
    </>
  );
}
