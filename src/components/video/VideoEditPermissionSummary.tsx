import * as React from "react";
import Link from "next/link";
import type { EditPermissionSummary } from "@/lib/video/collabPerms";

interface Props {
  videoId: string;
  summary: EditPermissionSummary;
  canManage: boolean;
  tableAvailable: boolean;
  privilegedQuery?: string;
}

export function VideoEditPermissionSummary({
  videoId,
  summary,
  canManage,
  tableAvailable,
  privilegedQuery = "",
}: Props): React.ReactElement {
  const manageHref = `/dashboard/edit/${encodeURIComponent(videoId)}/permissions${privilegedQuery}`;

  if (!tableAvailable) {
    return (
      <section className="fn-card fn-card-compact" style={{ marginTop: 20 }}>
        <div className="fn-card-body" style={{ padding: "14px 16px" }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>参加者の編集権限</h2>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            ローカル DB に video_members.can_edit がありません。
            <code style={{ fontSize: 11 }}> npm run db:local-apply </code>
            で migration を適用してください。
          </p>
        </div>
      </section>
    );
  }

  if (!canManage) {
    return (
      <section className="fn-card fn-card-compact" style={{ marginTop: 20 }}>
        <div className="fn-card-body" style={{ padding: "14px 16px" }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>参加者の編集権限</h2>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            編集できる人 {summary.editorCount}人
            {summary.unlinkedEditorCount > 0
              ? ` / 未連携 ${summary.unlinkedEditorCount}人`
              : ""}
          </p>
        </div>
      </section>
    );
  }

  const showWarning = summary.warnings.some((w) => w.tone === "warning");

  return (
    <section
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
              編集できる人 {summary.editorCount}人
              {summary.unlinkedEditorCount > 0
                ? ` · 未連携 ${summary.unlinkedEditorCount}人`
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
            まだ編集できる人はいません。
          </p>
        ) : null}

        {summary.warnings.map((w) => (
          <div
            key={w.title}
            role="status"
            style={{
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              lineHeight: 1.5,
              background:
                w.tone === "warning"
                  ? "var(--accent-warning-soft, #fef3c7)"
                  : "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
          >
            <strong>{w.title}</strong>
            {w.detail ? (
              <div style={{ marginTop: 4, color: "var(--text-muted)" }}>{w.detail}</div>
            ) : null}
          </div>
        ))}

        <div>
          <Link href={manageHref} className="fn-btn fn-btn-ghost fn-btn-sm">
            編集できる人を管理
          </Link>
        </div>
      </div>
    </section>
  );
}
