import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { auditLogs, users, xIdentityRequests, xUsers } from "@/lib/db/schema";
import { XLinkRequestTable, type XLinkRequestRow } from "@/components/admin/XLinkRequestTable";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserManagementTabs } from "@/components/admin/AdminUserManagementTabs";
import { parseAuditDiff } from "@/lib/audit/diff";
import { FnTable } from "@/components/ui/FnTable";
import { normalizeXId } from "@/lib/utils/xid";

export const metadata: Metadata = { title: "X ID 申請" };
export const dynamic = "force-dynamic";
const RECENT_HISTORY_LIMIT = 30;
const PENDING_LIMIT = 100;
const LINK_REQUEST_TYPES = ["new_link", "existing_link", "alias"] as const;

function requestTypeLabel(type: string): string {
  if (type === "new_link" || type === "existing_link") return "X ID連携";
  if (type === "alias") return "旧別名申請";
  return type;
}

type PendingBaseRow = {
  id: string;
  requested_x_id: string | null;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: string;
  target_x_user_id: string | null;
};

async function enrichPendingRows(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  pendingBase: PendingBaseRow[],
): Promise<XLinkRequestRow[]> {
  const xIds = new Set<string>();
  for (const row of pendingBase) {
    const requested = normalizeXId(row.requested_x_id);
    const target = normalizeXId(row.target_x_user_id);
    if (requested) xIds.add(requested);
    if (target) xIds.add(target);
  }

  const xUserById = new Map<string, { x_name: string; icon_url: string | null }>();
  if (xIds.size > 0) {
    const xUserRows = await db
      .select({
        id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
      })
      .from(xUsers)
      .where(inArray(xUsers.id, Array.from(xIds)));
    for (const row of xUserRows) {
      xUserById.set(row.id, { x_name: row.x_name, icon_url: row.icon_url });
    }
  }

  return pendingBase.map((row) => {
    const requestedXId = normalizeXId(row.requested_x_id);
    const targetXId = normalizeXId(row.target_x_user_id);
    const requestedXUser = requestedXId ? xUserById.get(requestedXId) : undefined;
    const targetXUser = targetXId ? xUserById.get(targetXId) : undefined;
    return {
      id: row.id,
      requested_x_id: requestedXId || "",
      requested_by_auth_user_id: row.requested_by_auth_user_id,
      discord_name: row.discord_name,
      discord_image: row.discord_image,
      requested_at: row.requested_at,
      request_type: row.request_type as XLinkRequestRow["request_type"],
      target_x_user_id: row.target_x_user_id,
      requested_x_name: requestedXUser?.x_name ?? null,
      requested_icon_url: requestedXUser?.icon_url ?? null,
      target_icon_url: targetXUser?.icon_url ?? null,
    };
  });
}

export default async function AdminXLinkRequestsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const pendingWhere = and(
    eq(xIdentityRequests.status, "pending"),
    inArray(xIdentityRequests.request_type, LINK_REQUEST_TYPES),
  )!;

  const [pendingBase, recentRejected, recentAuditLogs] = db
    ? await Promise.all([
        db
          .select({
            id: xIdentityRequests.id,
            requested_x_id: xIdentityRequests.requested_x_id,
            requested_by_auth_user_id: xIdentityRequests.requested_by_auth_user_id,
            discord_name: users.name,
            discord_image: users.image,
            requested_at: xIdentityRequests.requested_at,
            request_type: xIdentityRequests.request_type,
            target_x_user_id: xIdentityRequests.target_x_user_id,
          })
          .from(xIdentityRequests)
          .leftJoin(users, eq(users.id, xIdentityRequests.requested_by_auth_user_id))
          .where(pendingWhere)
          .orderBy(desc(xIdentityRequests.requested_at))
          .limit(PENDING_LIMIT),
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

  const pending = db ? await enrichPendingRows(db, pendingBase) : [];

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
