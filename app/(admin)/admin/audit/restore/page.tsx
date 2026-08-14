import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { auditLogs, auditRestoreRuns } from "@/lib/db/schema";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import { FnTable } from "@/components/ui/FnTable";

export const metadata: Metadata = { title: "復元履歴" };
export const dynamic = "force-dynamic";

const MAX_ROWS = 50;

export default async function AdminAuditRestorePage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const db = getDatabase();
  if (!db) notFound();

  const runs = await db
    .select()
    .from(auditRestoreRuns)
    .orderBy(desc(auditRestoreRuns.executed_at))
    .limit(MAX_ROWS);

  const auditIds = Array.from(new Set(runs.map((r) => r.audit_log_id)));
  const auditMap = new Map<string, (typeof auditLogs.$inferSelect)>();
  if (auditIds.length > 0) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(inArray(auditLogs.id, auditIds));
    for (const row of rows) {
      auditMap.set(row.id, row);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="復元履歴"
        description={`直近 ${MAX_ROWS} 件のリストア実行履歴を表示します。`}
        backHref="/admin/audit"
        backLabel="監査ログ一覧へ"
      />

      <AdminSectionTabs hub="audit" />

      {runs.length === 0 ? (
        <p
          className="fn-empty-message"
          style={{ padding: 16, textAlign: "center", marginTop: 16 }}
        >
          復元履歴はまだありません。
        </p>
      ) : (
        <FnTable style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>実行日時</th>
              <th>状態</th>
              <th>対象ログ</th>
              <th>テーブル / レコード</th>
              <th>実行者</th>
              <th>理由</th>
              <th>エラー</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const log = auditMap.get(run.audit_log_id);
              return (
                <tr key={run.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {formatUnix(run.executed_at)}
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatRelative(run.executed_at)}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`fn-badge ${
                        run.status === "success" ? "fn-badge-accent" : "fn-badge-danger"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    <Link href={`/admin/audit/${run.audit_log_id}`}>
                      {run.audit_log_id}
                    </Link>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {log ? (
                      <>
                        <span style={{ fontFamily: "monospace" }}>{log.table_name}</span>
                        <br />
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          {log.target_id}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ fontSize: 11, fontFamily: "monospace" }}>
                    {run.executed_by_user_id}
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 200, wordBreak: "break-word" }}>
                    {run.reason}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--accent-danger)" }}>
                    {run.error_message ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </FnTable>
      )}
    </div>
  );
}
