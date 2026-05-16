import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { historyLogs } from "@/lib/db/schema";
import { formatUnix, formatRelative } from "@/lib/utils/format";

export const metadata: Metadata = { title: "監査ログ" };
export const dynamic = "force-dynamic";

type HistoryRow = typeof historyLogs.$inferSelect;

/** JSON 文字列をオブジェクトへパースする。失敗時は null を返す */
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

/**
 * before / after の JSON を比較し、変更されたキー一覧と件数を返す。
 * フル diff ライブラリは使わず、トップレベルキーの値比較のみ行う。
 */
function diffSummary(row: HistoryRow): { keys: string[]; count: number } {
  const before = parseJson(row.before_data);
  const after = parseJson(row.after_data);

  if (!before && !after) return { keys: [], count: 0 };
  if (!before) {
    const keys = Object.keys(after ?? {});
    return { keys, count: keys.length };
  }
  if (!after) {
    const keys = Object.keys(before);
    return { keys, count: keys.length };
  }

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = Array.from(allKeys).filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
  return { keys: changed, count: changed.length };
}

export default async function AdminAuditPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

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
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>監査ログ</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        管理操作の直近 100 件を表示します。before / after の変更キーをサマリとして確認できます。
      </p>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>日時</th>
            <th>テーブル</th>
            <th>操作</th>
            <th>レコード ID</th>
            <th>実行者</th>
            <th>変更差分サマリ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const diff = diffSummary(h);
            return (
              <tr key={h.id}>
                <td>
                  <div style={{ whiteSpace: "nowrap" }}>{formatUnix(h.created_at)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {formatRelative(h.created_at)}
                  </div>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{h.table_name}</td>
                <td>
                  <span
                    className={`fn-badge ${
                      h.action === "DELETE"
                        ? "fn-badge-danger"
                        : h.action === "CREATE"
                          ? "fn-badge-accent"
                          : "fn-badge-soft"
                    }`}
                  >
                    {h.action}
                  </span>
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-secondary)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.record_id}
                </td>
                <td style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {h.operator_discord_id ?? "-"}
                </td>
                <td style={{ fontSize: 12 }}>
                  {h.action === "UPDATE" && diff.count === 0 ? (
                    <span style={{ color: "var(--text-muted)" }}>変更なし</span>
                  ) : h.action === "UPDATE" ? (
                    <>
                      <span
                        className="fn-badge fn-badge-soft"
                        style={{ marginRight: 6 }}
                      >
                        {diff.count} キー変更
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          wordBreak: "break-all",
                        }}
                      >
                        {diff.keys.slice(0, 6).join(", ")}
                        {diff.keys.length > 6 ? ` ほか ${diff.keys.length - 6} 件` : ""}
                      </span>
                    </>
                  ) : h.action === "CREATE" ? (
                    <span style={{ color: "var(--text-muted)" }}>新規作成</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>削除</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  監査ログはまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
