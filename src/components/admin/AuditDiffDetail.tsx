"use client";

import * as React from "react";
import { parseAuditDiff } from "@/lib/audit/diff";

interface Props {
  before: string | null;
  after: string | null;
  changedKeys?: string[];
}

function kindLabel(kind: string): string {
  if (kind === "added") return "追加";
  if (kind === "removed") return "削除";
  return "変更";
}

export function AuditDiffDetail({
  before,
  after,
}: Props): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const diff = React.useMemo(() => parseAuditDiff(before, after), [before, after]);
  const hasParseError = !diff.beforeParsed || !diff.afterParsed;

  if (!hasParseError && diff.changes.length === 0) return null;

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
            padding: 10,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            display: "grid",
            gap: 8,
          }}
        >
          {hasParseError ? (
            <p role="alert" style={{ margin: 0, color: "var(--accent-danger)" }}>
              JSONを解析できません。下のJSON全文で元データを確認してください。
            </p>
          ) : (
            <div
              role="table"
              aria-label="変更差分"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(116px, auto) minmax(70px, auto) 1fr 1fr",
                gap: 0,
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              <span role="columnheader" style={headerStyle}>項目</span>
              <span role="columnheader" style={headerStyle}>種別</span>
              <span role="columnheader" style={headerStyle}>変更前</span>
              <span role="columnheader" style={headerStyle}>変更後</span>
              {diff.changes.map((change, i) => (
                <React.Fragment key={change.key}>
                  <span role="cell" style={cellStyle(i, change.important)}>
                    {change.label}
                    {change.label !== change.key ? (
                      <span style={{ display: "block", fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                        {change.key}
                      </span>
                    ) : null}
                  </span>
                  <span role="cell" style={cellStyle(i, false)}>
                    <span className={`fn-badge ${change.important ? "fn-badge-warning" : "fn-badge-soft"}`}>
                      {kindLabel(change.kind)}
                    </span>
                  </span>
                  <span role="cell" style={cellStyle(i, false)}>
                    <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {change.beforeText}
                    </code>
                  </span>
                  <span role="cell" style={cellStyle(i, false)}>
                    <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {change.afterText}
                    </code>
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}

          <details>
            <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>
              JSON全文を表示
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 8 }}>
              <RawJson title="before" value={diff.beforePretty} />
              <RawJson title="after" value={diff.afterPretty} />
            </div>
          </details>
        </div>
      ) : null}
    </>
  );
}

const headerStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 10,
  fontWeight: 700,
  background: "var(--bg-surface)",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border-subtle)",
};

function cellStyle(index: number, important: boolean): React.CSSProperties {
  return {
    padding: "6px 8px",
    borderTop: index === 0 ? "0" : "1px solid var(--border-subtle)",
    background: important ? "color-mix(in srgb, var(--accent-warning) 10%, transparent)" : undefined,
    color: "var(--text-primary)",
  };
}

function RawJson({
  title,
  value,
}: {
  title: string;
  value: string | null;
}): React.ReactElement {
  return (
    <section>
      <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>{title}</h4>
      <pre
        style={{
          margin: 0,
          padding: 8,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          maxHeight: 260,
          overflow: "auto",
          fontSize: 11,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {value ?? "(null)"}
      </pre>
    </section>
  );
}
