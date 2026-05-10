import * as React from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs } from "@/lib/db/schema";
import { formatRelative, formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "履歴ログ" };
export const dynamic = "force-dynamic";

export default async function AdminHistoryPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const rows = db
    ? await db
        .select()
        .from(historyLogs)
        .orderBy(desc(historyLogs.created_at))
        .limit(80)
    : [];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>履歴ログ</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        管理操作とイベント編集者の操作を時系列で確認できます。 <code>retention_class = long_audit</code>
        は長期保管、それ以外は <code>history_retention_days</code> 経過で自動削除します。
      </p>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>日時</th>
            <th>テーブル / レコード</th>
            <th>操作</th>
            <th>主体</th>
            <th>変更内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>
                <div>{formatUnix(h.created_at)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatRelative(h.created_at)}
                </div>
              </td>
              <td>
                <div>{h.table_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {h.record_id}
                </div>
              </td>
              <td>
                <span
                  className={`fn-badge ${h.action === "DELETE" ? "fn-badge-danger" : h.action === "CREATE" ? "fn-badge-accent" : "fn-badge-soft"}`}
                >
                  {h.action}
                </span>
                <div style={{ marginTop: 4 }}>
                  <span className="fn-badge fn-badge-soft" style={{ fontSize: 9 }}>
                    {h.retention_class}
                  </span>
                </div>
              </td>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {h.operator_discord_id ? h.operator_discord_id.slice(0, 14) + "…" : "—"}
              </td>
              <td style={{ fontSize: 12, maxWidth: 360 }}>
                {h.after_data ? (
                  <details>
                    <summary>表示</summary>
                    <pre
                      style={{
                        fontSize: 10,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        margin: 0,
                      }}
                    >
                      {h.after_data}
                    </pre>
                  </details>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  履歴がまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
