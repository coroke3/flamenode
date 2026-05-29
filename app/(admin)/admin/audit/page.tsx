import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import Link from "next/link";
import {
  historyLogs,
  users as usersTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditTargetLink } from "@/components/admin/AuditTargetLink";
import { parseAuditDiff } from "@/lib/audit/diff";

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
    view?: string;
  }>;
}

type ViewMode = "table" | "timeline" | "cards";

function normalizeViewMode(raw: string | undefined): ViewMode {
  return raw === "timeline" || raw === "cards" ? raw : "table";
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 100;

function diffSummary(row: HistoryRow): { keys: string[]; count: number } {
  const diff = parseAuditDiff(row.before_data, row.after_data);
  return { keys: diff.changedKeys, count: diff.changedKeys.length };
}

export default async function AdminAuditPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const viewMode = normalizeViewMode(sp.view);
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
  let operatorMap = new Map<string, OperatorInfo>();
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

    // operator_discord_id を Discord 名 / X 名 / アイコンに解決する。
    // 行に保存された operator_snapshot_json があれば優先する (当時情報の保全)。
    const opIds = Array.from(
      new Set(
        rows
          .map((r) => r.operator_discord_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (opIds.length > 0) {
      const userJoin = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          image: usersTable.image,
          active_x_user_id: usersTable.active_x_user_id,
          x_name: xUsersTable.x_name,
          x_icon: xUsersTable.icon_url,
        })
        .from(usersTable)
        .leftJoin(
          xUsersTable,
          sql`lower(${xUsersTable.id}) = lower(${usersTable.active_x_user_id})`,
        )
        .where(inArray(usersTable.id, opIds));
      const map = new Map<string, (typeof userJoin)[number]>();
      for (const u of userJoin) map.set(u.id, u);
      operatorMap = map;
    }

    const tableRows = await db
      .select({ name: historyLogs.table_name })
      .from(historyLogs)
      .groupBy(historyLogs.table_name)
      .orderBy(sql`${historyLogs.table_name} ASC`);
    distinctTables = tableRows.map((r) => r.name);
  }

  return (
    <div>
      <AdminPageHeader
        title="監査ログ"
        description="管理操作を新しい順に表示します。before / after の変更キーをサマリで確認できます。"
      />

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
        <input type="hidden" name="view" value={viewMode} />
      </form>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 12,
        }}
      >
        <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
          {rows.length} 件表示中 (上限 {limit})
        </p>
        <ViewModeSwitch current={viewMode} sp={sp} />
      </div>

      {rows.length === 0 ? (
        <p
          className="fn-empty-message"
          style={{ padding: 16, textAlign: "center", marginTop: 8 }}
        >
          該当する監査ログはありません。
        </p>
      ) : viewMode === "timeline" ? (
        <TimelineView rows={rows} operatorMap={operatorMap} />
      ) : viewMode === "cards" ? (
        <CardsView rows={rows} operatorMap={operatorMap} />
      ) : (
        <TableView rows={rows} operatorMap={operatorMap} />
      )}
    </div>
  );
}

function buildViewHref(
  sp: NonNullable<Awaited<Props["searchParams"]>>,
  view: ViewMode,
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "view") usp.set(k, String(v));
  }
  usp.set("view", view);
  return `/admin/audit?${usp.toString()}`;
}

function ViewModeSwitch({
  current,
  sp,
}: {
  current: ViewMode;
  sp: NonNullable<Awaited<Props["searchParams"]>>;
}): React.ReactElement {
  const modes: { id: ViewMode; label: string }[] = [
    { id: "table", label: "テーブル" },
    { id: "timeline", label: "タイムライン" },
    { id: "cards", label: "カード" },
  ];
  return (
    <div
      role="tablist"
      aria-label="表示切替"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 2,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-pill)",
      }}
    >
      {modes.map((m) => (
        <Link
          key={m.id}
          role="tab"
          aria-selected={current === m.id}
          href={buildViewHref(sp, m.id)}
          className={`fn-btn fn-btn-sm ${
            current === m.id ? "fn-btn-primary" : "fn-btn-ghost"
          }`}
          style={{ borderRadius: "var(--radius-pill)" }}
        >
          {m.label}
        </Link>
      ))}
    </div>
  );
}

function ActionBadge({ action }: { action: string }): React.ReactElement {
  return (
    <span
      className={`fn-badge ${
        action === "DELETE"
          ? "fn-badge-danger"
          : action === "CREATE"
            ? "fn-badge-accent"
            : "fn-badge-soft"
      }`}
    >
      {action}
    </span>
  );
}

function DiffSummaryCell({
  row,
  diff,
}: {
  row: HistoryRow;
  diff: { keys: string[]; count: number };
}): React.ReactElement {
  if (row.action === "UPDATE" && diff.count === 0) {
    return <span style={{ color: "var(--text-muted)" }}>変更なし</span>;
  }
  if (row.action === "UPDATE") {
    return (
      <>
        <span className="fn-badge fn-badge-soft" style={{ marginRight: 6 }}>
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
          before={row.before_data}
          after={row.after_data}
          changedKeys={diff.keys}
        />
      </>
    );
  }
  if (row.action === "CREATE") {
    return <span style={{ color: "var(--text-muted)" }}>新規作成</span>;
  }
  return <span style={{ color: "var(--text-muted)" }}>削除</span>;
}

type OperatorInfo = {
  id: string;
  name: string | null;
  image: string | null;
  active_x_user_id: string | null;
  x_name: string | null;
  x_icon: string | null;
};

/**
 * 監査ログの実行者を「Discord 名 / @x_id (アイコン)」形式で表示する。
 * row.operator_snapshot_json があれば優先 (当時情報の保全)。
 */
function OperatorBadge({
  row,
  operatorMap,
}: {
  row: HistoryRow;
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  if (!row.operator_discord_id) {
    return <span style={{ color: "var(--text-muted)" }}>-</span>;
  }
  let snapshot: {
    discord_name?: string | null;
    x_user_id?: string | null;
    x_name?: string | null;
    icon_url?: string | null;
  } | null = null;
  if (row.operator_snapshot_json) {
    try {
      snapshot = JSON.parse(row.operator_snapshot_json);
    } catch {
      snapshot = null;
    }
  }
  const live = operatorMap.get(row.operator_discord_id);
  const displayName =
    snapshot?.discord_name ?? live?.name ?? row.operator_discord_id;
  const xId = snapshot?.x_user_id ?? live?.active_x_user_id ?? null;
  const xName = snapshot?.x_name ?? live?.x_name ?? null;
  const iconUrl = snapshot?.icon_url ?? live?.x_icon ?? live?.image ?? null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      {iconUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={iconUrl}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: 999, objectFit: "cover", flexShrink: 0 }}
        />
      ) : null}
      <span style={{ display: "grid", lineHeight: 1.15, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {xName ?? displayName}
        </span>
        {xId ? (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            @{xId}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function TableView({
  rows,
  operatorMap,
}: {
  rows: HistoryRow[];
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  return (
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
                <Link href={`/admin/audit/${h.id}`} style={{ whiteSpace: "nowrap" }}>
                  {formatUnix(h.created_at)}
                </Link>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatRelative(h.created_at)}
                </div>
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{h.table_name}</td>
              <td>
                <ActionBadge action={h.action} />
              </td>
              <td style={{ fontSize: 11 }}>
                <AuditTargetLink
                  tableName={h.table_name}
                  recordId={h.record_id}
                />
              </td>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                <OperatorBadge row={h} operatorMap={operatorMap} />
              </td>
              <td style={{ fontSize: 12 }}>
                <DiffSummaryCell row={h} diff={diff} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function groupByDay(rows: HistoryRow[]): [string, HistoryRow[]][] {
  const map = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = new Date(r.created_at * 1000)
      .toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries());
}

function TimelineView({
  rows,
  operatorMap,
}: {
  rows: HistoryRow[];
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  // 日付 (YYYY-MM-DD, JST) 単位でグルーピングして縦タイムラインに並べる。
  // 1 行 = 1 操作。左にタイムスタンプ、右にアクション + 差分サマリ。
  const groups = groupByDay(rows);

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 16 }}>
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border-subtle)",
              paddingBottom: 4,
              margin: 0,
            }}
          >
            {day}
          </h3>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: "8px 0 0 0",
              display: "grid",
              gap: 6,
              borderLeft: "2px solid var(--border-subtle)",
              paddingLeft: 14,
            }}
          >
            {items.map((h) => {
              const diff = diffSummary(h);
              return (
                <li
                  key={h.id}
                  style={{
                    position: "relative",
                    padding: "8px 10px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      fontSize: 12,
                    }}
                  >
                    <Link
                      href={`/admin/audit/${h.id}`}
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatUnix(h.created_at)}
                    </Link>
                    <ActionBadge action={h.action} />
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {h.table_name}
                    </span>
                    <AuditTargetLink
                      tableName={h.table_name}
                      recordId={h.record_id}
                    />
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      <OperatorBadge row={h} operatorMap={operatorMap} />
                    </span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    <DiffSummaryCell row={h} diff={diff} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function CardsView({
  rows,
  operatorMap,
}: {
  rows: HistoryRow[];
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: "8px 0 0 0",
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
      }}
    >
      {rows.map((h) => {
        const diff = diffSummary(h);
        return (
          <li
            key={h.id}
            style={{
              padding: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              display: "grid",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <ActionBadge action={h.action} />
              <Link
                href={`/admin/audit/${h.id}`}
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {formatUnix(h.created_at)}
              </Link>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                {formatRelative(h.created_at)}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span>{h.table_name}</span>
              <AuditTargetLink
                tableName={h.table_name}
                recordId={h.record_id}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              実行者: <OperatorBadge row={h} operatorMap={operatorMap} />
            </div>
            <div style={{ fontSize: 12 }}>
              <DiffSummaryCell row={h} diff={diff} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
