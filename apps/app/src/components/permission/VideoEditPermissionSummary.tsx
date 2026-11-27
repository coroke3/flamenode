import type { EditAccess, EditCollabSummary } from "@flamenode/contracts";
import type * as React from "react";

interface Props {
  videoId: string;
  summary: EditCollabSummary;
  privilegeMode: EditAccess["privilegeMode"];
}

// Keep the CURRENT management card's markup together to preserve its message and layout order.
export function VideoEditPermissionSummary({ videoId, summary, privilegeMode }: Props): React.ReactElement {
  const privilegedQuery = privilegeMode === "normal" ? "" : `?privileged=${privilegeMode}`;
  const manageHref = `/dashboard/edit/${encodeURIComponent(videoId)}/permissions${privilegedQuery}`;
  const showWarning = summary.warnings.some((warning) => warning.tone === "warning");

  return (
    <section
      id="video-collab-perms"
      className="fn-card fn-card-compact"
      style={{
        marginTop: 20,
        borderColor: showWarning ? "var(--accent-warning, #d97706)" : undefined,
      }}
    >
      <div className="fn-card-body" style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>参加者の編集権限</h2>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "var(--text-muted)",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>
              編集権限設定 {summary.editorCount}人
              {summary.unlinkedEditorCount > 0
                ? ` · X ID連携待ち ${summary.unlinkedEditorCount}人`
                : ""}
              {summary.notifiableEditorCount > 0 &&
              summary.notifiableEditorCount !== summary.editorCount
                ? ` · 通知可能 ${summary.notifiableEditorCount}人`
                : summary.editorCount > 0 && summary.unlinkedEditorCount === 0
                  ? ` · 通知可能 ${summary.notifiableEditorCount}人`
                  : ""}
            </span>
          </p>
        </div>

        {summary.displayNames ? (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{summary.displayNames}</p>
        ) : summary.editorCount === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            まだ編集権限を付与された人はいません。
          </p>
        ) : null}

        {summary.warnings.map((warning) => (
          <div
            key={warning.title}
            role="status"
            style={{
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              lineHeight: 1.5,
              background: warning.tone === "warning"
                ? "var(--accent-warning-soft, #fef3c7)"
                : "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
          >
            <strong>{warning.title}</strong>
            {warning.detail ? (
              <div style={{ marginTop: 4, color: "var(--text-muted)" }}>{warning.detail}</div>
            ) : null}
          </div>
        ))}

        <div>
          <a href={manageHref} className="fn-btn fn-btn-ghost fn-btn-sm">
            編集できる人を管理
          </a>
        </div>
      </div>
    </section>
  );
}
