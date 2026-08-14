import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/currentUser";
import Link from "next/link";
import {
  auditLogs,
  users as usersTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AuditDiffDetail } from "@/components/admin/AuditDiffDetail";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminSectionTabs } from "@/components/admin/AdminSectionTabs";
import { AuditTargetLink } from "@/components/admin/AuditTargetLink";
import { parseAuditDiff } from "@/lib/audit/diff";

export const metadata: Metadata = { title: "監査ログ" };
export const dynamic = "force-dynamic";

type AuditRow = typeof auditLogs.$inferSelect;

interface Props {
  searchParams?: Promise<{
    table?: string;
    operation?: string;
    actor?: string;
    /** 旧ブックマーク互換。新規リンクは actor を使う。 */
    operator?: string;
    record?: string;
    restore_status?: string;
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
const DEFAULT_LIMIT = 50;

const OPERATIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "RESTORE",
  "STATUS_CHANGE",
  "MERGE",
  "SYSTEM",
] as const;

const RESTORE_STATUSES = [
  "restorable",
  "restored",
  "expired",
  "not_restorable",
  "blocked",
  "failed",
] as const;

const COMMON_TABLES = [
  "videos",
  "events",
  "users",
  "x_users",
  "slots",
  "video_chapters",
  "video_members",
  "event_staff",
  "x_identity_requests",
  "notification_outbox",
  "system_settings",
  "system_settings",
] as const;

function diffSummary(row: AuditRow): { keys: string[]; count: number } {
  const diff = parseAuditDiff(row.before_json, row.after_json);
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
  const operationFilter = (sp.operation ?? "").trim().toUpperCase();
  const actorFilter = (sp.actor ?? sp.operator ?? "").trim();
  const recordFilter = (sp.record ?? "").trim();
  const restoreStatusFilter = (sp.restore_status ?? "").trim();
  const sinceFilter = (sp.since ?? "").trim();
  const untilFilter = (sp.until ?? "").trim();

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
  let rows: AuditRow[] = [];
  let operatorMap = new Map<string, OperatorInfo>();

  if (db) {
    const conds = [];
    if (tableFilter) conds.push(eq(auditLogs.table_name, tableFilter));
    if (OPERATIONS.includes(operationFilter as (typeof OPERATIONS)[number])) {
      conds.push(
        eq(
          auditLogs.operation,
          operationFilter as (typeof OPERATIONS)[number],
        ),
      );
    }
    if (actorFilter) conds.push(eq(auditLogs.actor_user_id, actorFilter));
    if (recordFilter) conds.push(eq(auditLogs.target_id, recordFilter));
    if (
      RESTORE_STATUSES.includes(
        restoreStatusFilter as (typeof RESTORE_STATUSES)[number],
      )
    ) {
      conds.push(
        eq(
          auditLogs.restore_status,
          restoreStatusFilter as (typeof RESTORE_STATUSES)[number],
        ),
      );
    }
    if (sinceUnix != null) conds.push(gte(auditLogs.created_at, sinceUnix));
    if (untilUnix != null) conds.push(lte(auditLogs.created_at, untilUnix));

    rows = await db
      .select()
      .from(auditLogs)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.created_at))
      .limit(limit);

    const actorIds = Array.from(
      new Set(rows.map((r) => r.actor_user_id).filter(Boolean)),
    );
    if (actorIds.length > 0) {
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
        .where(inArray(usersTable.id, actorIds));
      const map = new Map<string, (typeof userJoin)[number]>();
      for (const u of userJoin) map.set(u.id, u);
      operatorMap = map;
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="監査ログ"
        description="管理操作を新しい順に表示します。before / after の変更キーをサマリで確認できます。"
      />

      <AdminSectionTabs hub="audit" />

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
            {COMMON_TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>操作種別</span>
          <select name="operation" defaultValue={operationFilter} className="fn-input">
            <option value="">すべて</option>
            {OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>復元ステータス</span>
          <select
            name="restore_status"
            defaultValue={restoreStatusFilter}
            className="fn-input"
          >
            <option value="">すべて</option>
            <option value="restorable">復元可能</option>
            <option value="restored">復元済み</option>
            <option value="expired">期限切れ</option>
            <option value="not_restorable">復元不可</option>
            <option value="blocked">競合</option>
            <option value="failed">失敗</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>実行者 user_id</span>
          <input
            type="text"
            name="actor"
            defaultValue={actorFilter}
            className="fn-input"
            placeholder="user_id 完全一致"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
          <span style={{ color: "var(--text-muted)" }}>対象レコード ID</span>
          <input
            type="text"
            name="record"
            defaultValue={recordFilter}
            className="fn-input"
            placeholder="target_id 完全一致"
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

function OperationBadge({ operation }: { operation: string }): React.ReactElement {
  const cls =
    operation === "DELETE"
      ? "fn-badge-danger"
      : operation === "CREATE"
        ? "fn-badge-accent"
        : operation === "RESTORE"
          ? "fn-badge-warning"
          : operation === "SYSTEM"
            ? "fn-badge-soft"
            : "fn-badge-soft";
  return <span className={`fn-badge ${cls}`}>{operation}</span>;
}

const RESTORE_STATUS_MAP: Record<
  string,
  { label: string; cls: string }
> = {
  restorable: { label: "復元可能", cls: "fn-badge-accent" },
  restored: { label: "復元済み", cls: "fn-badge-soft" },
  expired: { label: "期限切れ", cls: "fn-badge-warning" },
  not_restorable: { label: "復元不可", cls: "" },
  blocked: { label: "競合", cls: "fn-badge-warning" },
  failed: { label: "失敗", cls: "fn-badge-danger" },
};

function RestoreStatusBadge({
  status,
}: {
  status: string;
}): React.ReactElement | null {
  if (status === "not_restorable") return null;
  const info = RESTORE_STATUS_MAP[status];
  if (!info) return null;
  return <span className={`fn-badge ${info.cls}`}>{info.label}</span>;
}

function DiffSummaryCell({
  row,
  diff,
}: {
  row: AuditRow;
  diff: { keys: string[]; count: number };
}): React.ReactElement {
  if (row.operation === "UPDATE" && diff.count === 0) {
    return <span style={{ color: "var(--text-muted)" }}>変更なし</span>;
  }
  if (row.operation === "UPDATE") {
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
          before={row.before_json}
          after={row.after_json}
          changedKeys={diff.keys}
        />
      </>
    );
  }
  if (row.operation === "CREATE") {
    return <span style={{ color: "var(--text-muted)" }}>新規作成</span>;
  }
  if (row.operation === "DELETE") {
    return <span style={{ color: "var(--text-muted)" }}>削除</span>;
  }
  return (
    <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 11 }}>
      {row.context ?? row.operation}
    </span>
  );
}

type OperatorInfo = {
  id: string;
  name: string | null;
  image: string | null;
  active_x_user_id: string | null;
  x_name: string | null;
  x_icon: string | null;
};

function OperatorBadge({
  row,
  operatorMap,
}: {
  row: AuditRow;
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  let snapshot: {
    discord_name?: string | null;
    x_user_id?: string | null;
    x_name?: string | null;
    icon_url?: string | null;
  } | null = null;
  if (row.actor_snapshot_json) {
    try {
      snapshot = JSON.parse(row.actor_snapshot_json);
    } catch {
      snapshot = null;
    }
  }
  const live = operatorMap.get(row.actor_user_id);
  const displayName =
    snapshot?.discord_name ?? live?.name ?? row.actor_user_id;
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
  rows: AuditRow[];
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
  return (
    <FnTable style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th>日時</th>
          <th>テーブル</th>
          <th>操作</th>
          <th>対象 ID</th>
          <th>復元</th>
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
                <OperationBadge operation={h.operation} />
              </td>
              <td style={{ fontSize: 11 }}>
                <AuditTargetLink
                  tableName={h.table_name}
                  recordId={h.target_id}
                />
              </td>
              <td>
                <RestoreStatusBadge status={h.restore_status} />
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
    </FnTable>
  );
}

function groupByDay(rows: AuditRow[]): [string, AuditRow[]][] {
  const map = new Map<string, AuditRow[]>();
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
  rows: AuditRow[];
  operatorMap: Map<string, OperatorInfo>;
}): React.ReactElement {
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
                    <OperationBadge operation={h.operation} />
                    <RestoreStatusBadge status={h.restore_status} />
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
                      recordId={h.target_id}
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
  rows: AuditRow[];
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
              <OperationBadge operation={h.operation} />
              <RestoreStatusBadge status={h.restore_status} />
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
                recordId={h.target_id}
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
