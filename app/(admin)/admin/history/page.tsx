import * as React from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs } from "@/lib/db/schema";
import { formatRelative, formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "履歴ログ" };
export const dynamic = "force-dynamic";

type HistoryRow = typeof historyLogs.$inferSelect;

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function describeHistory(row: HistoryRow): string {
  const before = parseJson(row.before_data);
  const after = parseJson(row.after_data);
  const table = row.table_name;
  const target = row.record_id;

  if (row.action === "CREATE") return `${table} に ${target} を作成しました。`;
  if (row.action === "DELETE") return `${table} から ${target} を削除しました。`;

  const changedKeys = new Set<string>();
  for (const key of Object.keys(before ?? {})) changedKeys.add(key);
  for (const key of Object.keys(after ?? {})) changedKeys.add(key);
  const changed = Array.from(changedKeys).filter(
    (key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null),
  );
  if (changed.length === 0) return `${table} の ${target} を更新しました。`;
  return `${table} の ${target} を更新しました。変更項目: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? " ほか" : ""}`;
}

export default async function AdminHistoryPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const rows = db
    ? await db
        .select()
        .from(historyLogs)
        .orderBy(desc(historyLogs.created_at))
        .limit(100)
    : [];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>履歴ログ</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        管理操作と投稿・イベント編集の履歴です。各行に日本語の操作要約と、復元判断に使う before / after データを表示します。
      </p>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>日時</th>
            <th>対象</th>
            <th>操作</th>
            <th>実行者</th>
            <th>内容</th>
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
                {h.operator_discord_id ? h.operator_discord_id : "-"}
              </td>
              <td style={{ fontSize: 12, maxWidth: 460 }}>
                <p style={{ margin: 0, color: "var(--text-primary)", fontWeight: 600 }}>
                  {describeHistory(h)}
                </p>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>
                    JSONを見る
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {h.before_data ? (
                      <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>
                        before: {h.before_data}
                      </pre>
                    ) : null}
                    {h.after_data ? (
                      <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>
                        after: {h.after_data}
                      </pre>
                    ) : null}
                  </div>
                </details>
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
                  履歴はまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
