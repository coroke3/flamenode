import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { auditLogs, users, videos, xIdentityRequests, xUsers } from "@/lib/db/schema";
import { XLinkRequestTable } from "@/components/admin/XLinkRequestTable";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserManagementTabs } from "@/components/admin/AdminUserManagementTabs";
import { parseAuditDiff } from "@/lib/audit/diff";
import { FnTable } from "@/components/ui/FnTable";

export const metadata: Metadata = { title: "X ID 申請" };
export const dynamic = "force-dynamic";
const RECENT_HISTORY_LIMIT = 30;
const LINK_REQUEST_TYPES = ["new_link", "existing_link", "alias"] as const;

function requestTypeLabel(type: string): string {
  if (type === "new_link" || type === "existing_link") return "X ID連携";
  if (type === "alias") return "旧別名申請";
  return type;
}

export default async function AdminXLinkRequestsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const pendingWhere = and(
    eq(xIdentityRequests.status, "pending"),
    inArray(xIdentityRequests.request_type, LINK_REQUEST_TYPES),
  )!;

  const [pending, recentRejected, recentAuditLogs] = db
    ? await Promise.all([
        db
          .select({
            id: xIdentityRequests.id,
            requested_x_id: sql<string>`COALESCE(${xIdentityRequests.requested_x_id}, '')`,
            requested_by_auth_user_id: xIdentityRequests.requested_by_auth_user_id,
            discord_name: users.name,
            discord_image: users.image,
            requested_at: xIdentityRequests.requested_at,
            request_type: xIdentityRequests.request_type,
            target_x_user_id: xIdentityRequests.target_x_user_id,
            requested_x_name: sql<string | null>`(
              SELECT ${xUsers.x_name} FROM ${xUsers}
              WHERE lower(${xUsers.id}) = lower(${xIdentityRequests.requested_x_id}) LIMIT 1
            )`,
            requested_icon_url: sql<string | null>`COALESCE(
              (SELECT ${xUsers.icon_url} FROM ${xUsers}
               WHERE lower(${xUsers.id}) = lower(${xIdentityRequests.requested_x_id}) LIMIT 1),
              (SELECT ${videos.creator_icon_url} FROM ${videos}
               WHERE lower(${videos.creator_x_user_id}) = lower(${xIdentityRequests.requested_x_id})
                 AND ${videos.creator_icon_url} IS NOT NULL
               ORDER BY ${videos.created_at} DESC LIMIT 1)
            )`,
            target_icon_url: sql<string | null>`COALESCE(
              (SELECT ${xUsers.icon_url} FROM ${xUsers}
               WHERE lower(${xUsers.id}) = lower(${xIdentityRequests.target_x_user_id}) LIMIT 1),
              (SELECT ${videos.creator_icon_url} FROM ${videos}
               WHERE lower(${videos.creator_x_user_id}) = lower(${xIdentityRequests.target_x_user_id})
                 AND ${videos.creator_icon_url} IS NOT NULL
               ORDER BY ${videos.created_at} DESC LIMIT 1)
            )`,
          })
          .from(xIdentityRequests)
          .leftJoin(users, eq(users.id, xIdentityRequests.requested_by_auth_user_id))
          .where(pendingWhere)
          .orderBy(desc(xIdentityRequests.requested_at)),
        db
          .select({
            id: xIdentityRequests.id,
            requested_x_id: xIdentityRequests.requested_x_id,
            requested_by_auth_user_id: xIdentityRequests.requested_by_auth_user_id,
            request_type: xIdentityRequests.request_type,
            requested_at: xIdentityRequests.requested_at,
          })
          .from(xIdentityRequests)
          .where(
            and(
              eq(xIdentityRequests.status, "rejected"),
              inArray(xIdentityRequests.request_type, LINK_REQUEST_TYPES),
            )!,
          )
          .orderBy(desc(xIdentityRequests.requested_at))
          .limit(10),
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              inArray(auditLogs.table_name, [
                "x_identity_requests",
                "x_user_account_links",
                "x_users",
              ]),
              inArray(auditLogs.operation, ["UPDATE", "CREATE", "DELETE"]),
            )!,
          )
          .orderBy(desc(auditLogs.created_at))
          .limit(RECENT_HISTORY_LIMIT),
      ])
    : [[], [], []];

  return (
    <div>
      <AdminPageHeader
        title="X ID 申請"
        description="X ID連携申請を確認します。統合と差し戻しはX ID統合管理で処理します。"
      />
      <AdminUserManagementTabs active="link-requests" />
      <nav aria-label="X ID申請管理" style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href="/admin/x-id-merges" className="fn-btn fn-btn-sm fn-btn-ghost">統合・差し戻し</Link>
      </nav>

      <XLinkRequestTable rows={pending} />

      {recentRejected.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
            直近の却下申請
          </h2>
          <FnTable>
            <thead><tr><th>申請 X ID</th><th>種別</th><th>申請者ユーザー ID</th><th>申請日時</th></tr></thead>
            <tbody>
              {recentRejected.map((row) => (
                <tr key={row.id}>
                  <td>@{row.requested_x_id ?? "—"}</td>
                  <td><span className="fn-badge fn-badge-soft">{requestTypeLabel(row.request_type)}</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.requested_by_auth_user_id}</td>
                  <td className="fn-muted">{formatRelative(row.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        </section>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          直近の処理履歴
        </h2>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 4 }}>
          詳細は <Link href="/admin/audit?table=x_identity_requests">監査ログ</Link> で確認できます。
        </p>
        {recentAuditLogs.length > 0 ? (
          <FnTable style={{ marginTop: 8 }}>
            <thead><tr><th>日時</th><th>テーブル</th><th>操作</th><th>対象 ID</th><th>差分</th></tr></thead>
            <tbody>
              {recentAuditLogs.map((log) => {
                const changed = parseAuditDiff(log.before_json, log.after_json).changedKeys;
                return (
                  <tr key={log.id}>
                    <td><div>{formatUnix(log.created_at)}</div><div className="fn-muted" style={{ fontSize: 11 }}>{formatRelative(log.created_at)}</div></td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{log.table_name}</td>
                    <td>{log.operation}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{log.target_id ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{changed.slice(0, 6).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </FnTable>
        ) : <p className="fn-muted fn-text-sm">履歴はまだありません。</p>}
      </section>
    </div>
  );
}
