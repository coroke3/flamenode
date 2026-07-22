"use client";

import * as React from "react";
import {
  getAuditLogDryRun,
  restoreAuditLogAction,
  type AuditLogDryRunResult,
  type RestoreAuditLogActionResult,
} from "@/lib/actions/audit-admin";

interface Props {
  auditId: string;
  restoreStatus: string;
  restoreUnavailableReasonCode?: string | null;
  restoreUnavailableMessage?: string | null;
}

export function AuditRestoreForm({
  auditId,
  restoreStatus,
  restoreUnavailableReasonCode,
  restoreUnavailableMessage,
}: Props): React.ReactElement {
  const confirmRequired = `RESTORE ${auditId}`;

  const [dryRunResult, setDryRunResult] = React.useState<AuditLogDryRunResult | null>(
    null,
  );
  const [dryRunLoading, setDryRunLoading] = React.useState(false);
  const [restoreResult, setRestoreResult] =
    React.useState<RestoreAuditLogActionResult | null>(null);
  const [restoreLoading, setRestoreLoading] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [forceOverwrite, setForceOverwrite] = React.useState(false);

  const canRestore = restoreStatus === "restorable";

  async function handleDryRun(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason.trim()) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const fd = new FormData();
      fd.set("audit_id", auditId);
      fd.set("reason", reason);
      const result = await getAuditLogDryRun(fd);
      setDryRunResult(result);
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleRestore(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmText !== confirmRequired) return;
    setRestoreLoading(true);
    setRestoreResult(null);
    try {
      const fd = new FormData();
      fd.set("audit_id", auditId);
      fd.set("reason", reason);
      fd.set("confirm_text", confirmText);
      fd.set("force_overwrite", forceOverwrite ? "1" : "0");
      const result = await restoreAuditLogAction(fd);
      setRestoreResult(result);
    } finally {
      setRestoreLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          padding: 12,
          background: "color-mix(in srgb, var(--accent-warning) 12%, transparent)",
          border: "1px solid var(--accent-warning)",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
        }}
      >
        <strong>注意:</strong>{" "}
        アプリDB上の状態のみ復元します。YouTube / Discord / 外部APIの状態は復元されません。
      </div>

      {!canRestore ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            padding: 12,
            border:
              "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-elevated)",
            fontSize: 13,
          }}
        >
          <strong>このログは復元できません。</strong>

          {restoreUnavailableMessage ? (
            <p style={{ margin: 0 }}>
              {restoreUnavailableMessage}
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              復元状態: {restoreStatus}
            </p>
          )}

          {restoreUnavailableReasonCode ? (
            <code
              className="admin-audit-diff-grid"
              style={{
                color: "var(--text-muted)",
                fontSize: 11,
              }}
            >
              {restoreUnavailableReasonCode}
            </code>
          ) : null}
        </div>
      ) : null}

      {canRestore && (
        <>
          <div style={{ display: "grid", gap: 8 }}>
            <label
              style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}
            >
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>
                理由 <span style={{ color: "var(--accent-danger)" }}>*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="fn-input"
                rows={2}
                placeholder="リストアの理由を入力してください"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>
          </div>

          {/* Dry Run */}
          <form onSubmit={handleDryRun} style={{ display: "grid", gap: 8 }}>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              ドライラン (競合チェック)
            </h3>
            <button
              type="submit"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              disabled={dryRunLoading || !reason.trim()}
              style={{ alignSelf: "flex-start" }}
            >
              {dryRunLoading ? "確認中…" : "競合チェック実行"}
            </button>
            {dryRunResult && (
              <DryRunResult result={dryRunResult} />
            )}
          </form>

          {/* Execute Restore */}
          <form onSubmit={handleRestore} style={{ display: "grid", gap: 8 }}>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              リストア実行
            </h3>
            <label
              style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}
            >
              <span style={{ color: "var(--text-muted)" }}>
                確認テキスト: <code style={{ fontFamily: "monospace" }}>{confirmRequired}</code> と入力してください
              </span>
              <input
                type="text"
                className="fn-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmRequired}
                autoComplete="off"
              />
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={forceOverwrite}
                onChange={(e) => setForceOverwrite(e.target.checked)}
              />
              <span>
                競合を強制上書き (force_overwrite) ―{" "}
                <span style={{ color: "var(--accent-danger)" }}>
                  現行レコードと競合しても上書きします
                </span>
              </span>
            </label>
            <button
              type="submit"
              className="fn-btn fn-btn-danger fn-btn-sm"
              disabled={
                restoreLoading ||
                confirmText !== confirmRequired ||
                !reason.trim()
              }
              style={{ alignSelf: "flex-start" }}
            >
              {restoreLoading ? "実行中…" : "リストア実行"}
            </button>
            {restoreResult && (
              <div
                style={{
                  padding: 10,
                  background: restoreResult.ok
                    ? "color-mix(in srgb, var(--accent-success, #22c55e) 12%, transparent)"
                    : "color-mix(in srgb, var(--accent-danger) 12%, transparent)",
                  border: `1px solid ${restoreResult.ok ? "var(--accent-success, #22c55e)" : "var(--accent-danger)"}`,
                  borderRadius: "var(--radius-sm)",
                  fontSize: 13,
                }}
              >
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {restoreResult.ok ? "リストア完了" : "エラー"}
                </p>
                {restoreResult.message && (
                  <p style={{ margin: "4px 0 0", fontSize: 12 }}>{restoreResult.message}</p>
                )}
                {restoreResult.restore_run_id && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 11,
                      fontFamily: "monospace",
                      color: "var(--text-muted)",
                    }}
                  >
                    run_id: {restoreResult.restore_run_id}
                  </p>
                )}
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}

function DryRunResult({
  result,
}: {
  result: AuditLogDryRunResult;
}): React.ReactElement {
  const conflicts = result.diff?.conflicts ?? [];
  return (
    <div
      style={{
        padding: 10,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        display: "grid",
        gap: 6,
      }}
    >
      <p
        style={{
          margin: 0,
          fontWeight: 600,
          color: result.ok ? "inherit" : "var(--accent-danger)",
        }}
      >
        {result.ok ? "ドライラン成功" : "ドライランエラー"}
      </p>
      {result.message && (
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>{result.message}</p>
      )}
      {conflicts.length > 0 && (
        <div>
          <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--accent-warning)" }}>
            競合キー ({conflicts.length}):
          </p>
          <ul style={{ margin: 0, paddingLeft: 16, fontFamily: "monospace", fontSize: 11 }}>
            {conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {result.diff && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 11 }}>
            差分詳細を表示
          </summary>
          <div
              style={{
                display: "grid",
              gap: 8,
              marginTop: 8,
            }}
          >
            <section>
              <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>現行レコード</h4>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 10,
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {result.diff.current
                  ? JSON.stringify(result.diff.current, null, 2)
                  : "(null)"}
              </pre>
            </section>
            <section>
              <h4 style={{ margin: "0 0 4px", fontSize: 11 }}>復元後 (target)</h4>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 10,
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {result.diff.target
                  ? JSON.stringify(result.diff.target, null, 2)
                  : "(null)"}
              </pre>
            </section>
          </div>
        </details>
      )}
    </div>
  );
}
