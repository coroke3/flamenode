import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import Link from "next/link";
import { historyLogs } from "@/lib/db/schema";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";

export const metadata: Metadata = { title: "監査ログ" };
export const dynamic = "force-dynamic";

type HistoryRow = typeof historyLogs.$inferSelect;

interface Props {
  searchParams?: Promise<{
    table?: string;
    action?: string;
    operator?: string;
    record?: string;
    limit?: string;
    since?: string;
    until?: string;
  }>;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

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

export default async function AdminAuditPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const tableFilter = (sp.table ?? "").trim();
  const actionFilter = (sp.action ?? "").trim().toUpperCase();
  const operatorFilter = (sp.operator ?? "").trim();
  const recordFilter = (sp.record ?? "").trim();
  const sinceFilter = (sp.since ?? "").trim();
  const untilFilter = (sp.until ?? "").trim();
  // YYYY-MM-DD を JST 0:00 / 24:00 として Unix 秒に変換 (failure 時は null)
  const parseDateBoundary = (s: string, end: boolean): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const suffix = end ? "T23:59:59+09:00" : "T00:00:00+09:00";
    const t = Date.parse(`${s}${suffix}`);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  };
  const sinceUnix = sinceFilter ? parseDateBoundary(sinceFilter, false) : null;
  const untilUnix = untilFilter ? parseDateBoundary(untilFilter, true) : null;
  const limitRaw = Number(sp.limit ?? "");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const db = getDatabase();
  let rows: HistoryRow[] = [];
  let distinctTables: string[] = [];
  if (db) {
    const conds = [];
    if (tableFilter) conds.push(eq(historyLogs.table_name, tableFilter));
    if (actionFilter === "CREATE" || actionFilter === "UPDATE" || actionFilter === "DELETE") {
      conds.push(eq(historyLogs.action, actionFilter));
    }
    if (operatorFilter) conds.push(eq(historyLogs.operator_discord_id, operatorFilter));
    if (recordFilter) conds.push(eq(historyLogs.record_id, recordFilter));
    if (sinceUnix != null) conds.push(gte(historyLogs.created_at, sinceUnix));
    if (untilUnix != null) conds.push(lte(historyLogs.created_at, untilUnix));

    rows = await db
      .select()
      .from(historyLogs)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(historyLogs.created_at))
      .limit(limit);

    const tableRows = await db
      .select({ name: historyLogs.table_name })
      .from(historyLogs)
      .groupBy(historyLogs.table_name)
      .orderBy(sql`${historyLogs.table_name} ASC`);
    distinctTables = tableRows.map((r) => r.name);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>監査ログ</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        管理操作を新しい順に表示します。before / after の変更キーをサマリで確認できます。
      </p>

      <form
        method="get"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginTop: 16,
          padding: 12,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>テーブル</span>
          <select name="table" defaultValue={tableFilter} className="fn-input">
            <option value="">すべて</option>
            {distinctTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>操作</span>
          <select name="action" defaultValue={actionFilter} className="fn-input">
            <option value="">すべて</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>実行者 Discord ID</span>
          <input
            type="text"
            name="operator"
            defaultValue={operatorFilter}
            className="fn-input"
            placeholder="discord_id"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>レコード ID</span>
          <input
            type="text"
            name="record"
            defaultValue={recordFilter}
            className="fn-input"
            placeholder="record_id 完全一致"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>件数 (最大 {MAX_LIMIT})</span>
          <input
            type="number"
            name="limit"
            defaultValue={limit}
            min={1}
            max={MAX_LIMIT}
            className="fn-input"
            style={{ width: 100 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>since (YYYY-MM-DD, JST)</span>
          <input
            type="date"
            name="since"
            defaultValue={sinceFilter}
            className="fn-input"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>until (YYYY-MM-DD, JST)</span>
          <input
            type="date"
            name="until"
            defaultValue={untilFilter}
            className="fn-input"
          />
        </label>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          絞り込む
        </button>
      </form>

      <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 12 }}>
        {rows.length} 件表示中 (上限 {limit})
      </p>

      <table className="fn-table" style={{ marginTop: 8 }}>
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
                  <Link
                    href={`/admin/audit/${h.id}`}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {formatUnix(h.created_at)}
                  </Link>
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
                      <AuditDiffDetail
                        before={h.before_data}
                        after={h.after_data}
                        changedKeys={diff.keys}
                      />
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
                  該当する監査ログはありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
