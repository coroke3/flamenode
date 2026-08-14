"use client";

import * as React from "react";
import Link from "next/link";
import { FnTable } from "@/components/ui/FnTable";
import { formatRelative, formatUnix } from "@/lib/utils/format";
import {
  staticRebuildAdminHref,
  staticRebuildStatusLabel,
  staticRebuildTargetIdHint,
  staticRebuildTargetLabel,
} from "@/lib/admin/staticRebuildLabels";
import { retryFailedStaticRebuild } from "@/lib/actions/static-rebuild-admin";
import { writeTextToClipboard } from "@/lib/utils/clipboard";

export type StaticRebuildRow = {
  id: string;
  target_type: string;
  target_id: string;
  status: string;
  reason: string | null;
  priority: string;
  attempt_count: number;
  updated_at: number;
  error: string | null;
};

interface StaticRebuildQueuePanelProps {
  rows: StaticRebuildRow[];
  retryAllAction: () => Promise<void>;
}

function CopyButton({ text, label }: { text: string; label: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => {
          void (async () => {
            setCopyError(false);
            const copiedSuccessfully = await writeTextToClipboard(text);
            if (!copiedSuccessfully) {
              setCopied(false);
              setCopyError(true);
              return;
            }
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })();
        }}
        aria-label={`${label}をコピー`}
      >
        {copied ? "コピー済" : label}
      </button>
      {copyError ? (
        <span role="status" className="fn-muted" style={{ fontSize: 11 }}>
          失敗
        </span>
      ) : null}
    </span>
  );
}

export function StaticRebuildQueuePanel({
  rows,
  retryAllAction,
}: StaticRebuildQueuePanelProps): React.ReactElement {
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <>
      {failedCount > 0 ? (
        <form action={retryAllAction} style={{ marginBottom: 12 }}>
          <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
            失敗 {failedCount} 件を一括再試行
          </button>
        </form>
      ) : null}

      <FnTable>
        <thead>
          <tr>
            <th>状態</th>
            <th>対象種別</th>
            <th>対象ID</th>
            <th>理由</th>
            <th>優先度</th>
            <th>試行</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="fn-muted">
                キューは空です（編集がなければ再生成されません）。
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const adminHref = staticRebuildAdminHref(row.target_type, row.target_id);
              const targetKey = `${row.target_type}:${row.target_id}`;
              return (
                <tr key={row.id}>
                  <td>
                    <span
                      className={`fn-badge ${
                        row.status === "failed"
                          ? "fn-badge-danger"
                          : row.status === "processing"
                            ? "fn-badge-warning"
                            : row.status === "done"
                              ? "fn-badge-accent"
                              : "fn-badge-soft"
                      }`}
                    >
                      {staticRebuildStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{staticRebuildTargetLabel(row.target_type)}</div>
                    <div className="fn-muted fn-text-sm">
                      <code>{row.target_type}</code>
                    </div>
                  </td>
                  <td>
                    <div title={staticRebuildTargetIdHint(row.target_type)}>
                      <code style={{ wordBreak: "break-all" }}>{row.target_id}</code>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      <CopyButton text={row.target_type} label="type" />
                      <CopyButton text={row.target_id} label="id" />
                      <CopyButton text={targetKey} label="両方" />
                    </div>
                  </td>
                  <td>{row.reason ?? "—"}</td>
                  <td>{row.priority}</td>
                  <td>{row.attempt_count}</td>
                  <td title={formatUnix(row.updated_at)}>{formatRelative(row.updated_at)}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {row.status === "failed" ? (
                        <form action={retryFailedStaticRebuild}>
                          <input type="hidden" name="queue_id" value={row.id} />
                          <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
                            再試行
                          </button>
                        </form>
                      ) : null}
                      {adminHref ? (
                        <Link href={adminHref} className="fn-btn fn-btn-ghost fn-btn-sm">
                          関連管理
                        </Link>
                      ) : null}
                      {row.error ? (
                        <details>
                          <summary className="fn-text-sm" style={{ cursor: "pointer", color: "var(--accent-danger)" }}>
                            エラー詳細
                          </summary>
                          <pre
                            style={{
                              marginTop: 6,
                              padding: 8,
                              fontSize: 11,
                              maxWidth: 280,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              background: "var(--bg-elevated)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            {row.error}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </FnTable>
    </>
  );
}
