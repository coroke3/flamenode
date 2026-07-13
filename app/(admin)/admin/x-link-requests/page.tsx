import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  auditLogs,
  users,
  xAccountLinkRequests,
  xUserIcons,
  xUsers,
} from "@/lib/db/schema";
import { XLinkRequestTable } from "@/components/admin/XLinkRequestTable";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserManagementTabs } from "@/components/admin/AdminUserManagementTabs";
import { parseAuditDiff } from "@/lib/audit/diff";

export const metadata: Metadata = { title: "X ID 連携申請" };
export const dynamic = "force-dynamic";

const RECENT_HISTORY_LIMIT = 30;

interface Props {
  searchParams?: Promise<{ type?: string }>;
}

export default async function AdminXLinkRequestsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const linkTypeFilter =
    sp.type === "new" || sp.type === "merge" || sp.type === "alias" ? sp.type : "all";

  const db = getDatabase();
  const pendingWhere =
    linkTypeFilter === "all"
      ? eq(xAccountLinkRequests.status, "pending")
      : and(
          eq(xAccountLinkRequests.status, "pending"),
          eq(xAccountLinkRequests.link_type, linkTypeFilter),
        )!;
  const pending = db
    ? await db
        .select({
          id: xAccountLinkRequests.id,
          requested_x_id: xAccountLinkRequests.requested_x_id,
          user_id: xAccountLinkRequests.user_id,
          discord_name: users.name,
          discord_image: users.image,
          requested_at: xAccountLinkRequests.requested_at,
          link_type: xAccountLinkRequests.link_type,
          target_x_user_id: xAccountLinkRequests.target_x_user_id,
          requested_x_name: sql<string | null>`(
            SELECT ${xUsers.x_name}
            FROM ${xUsers}
            WHERE lower(${xUsers.id}) = lower(${xAccountLinkRequests.requested_x_id})
            LIMIT 1
          )`,
          requested_icon_url: sql<string | null>`COALESCE(
            (
              SELECT ${xUsers.icon_url}
              FROM ${xUsers}
              WHERE lower(${xUsers.id}) = lower(${xAccountLinkRequests.requested_x_id})
              LIMIT 1
            ),
            (
              SELECT ${xUserIcons.icon_url}
              FROM ${xUserIcons}
              WHERE lower(${xUserIcons.x_user_id}) = lower(${xAccountLinkRequests.requested_x_id})
              ORDER BY ${xUserIcons.created_at} DESC
              LIMIT 1
            )
          )`,
          target_icon_url: sql<string | null>`COALESCE(
            (
              SELECT ${xUsers.icon_url}
              FROM ${xUsers}
              WHERE lower(${xUsers.id}) = lower(${xAccountLinkRequests.target_x_user_id})
              LIMIT 1
            ),
            (
              SELECT ${xUserIcons.icon_url}
              FROM ${xUserIcons}
              WHERE lower(${xUserIcons.x_user_id}) = lower(${xAccountLinkRequests.target_x_user_id})
              ORDER BY ${xUserIcons.created_at} DESC
              LIMIT 1
            )
          )`,
        })
        .from(xAccountLinkRequests)
        .leftJoin(users, eq(users.id, xAccountLinkRequests.user_id))
        .where(pendingWhere)
        .orderBy(desc(xAccountLinkRequests.requested_at))
    : [];

  // 直近の却下リクエスト (履歴の参照用)
  const recentRejected = db
    ? await db
        .select({
          id: xAccountLinkRequests.id,
          requested_x_id: xAccountLinkRequests.requested_x_id,
          user_id: xAccountLinkRequests.user_id,
          link_type: xAccountLinkRequests.link_type,
          requested_at: xAccountLinkRequests.requested_at,
        })
        .from(xAccountLinkRequests)
        .where(eq(xAccountLinkRequests.status, "rejected"))
        .orderBy(desc(xAccountLinkRequests.requested_at))
        .limit(10)
    : [];

  // 直近の承認/却下監査を audit_logs (table_name 'x_account_link_requests' / 'x_users') から取得
  const recentAuditLogs = db
    ? await db
        .select()
        .from(auditLogs)
        .where(
          and(
            inArray(auditLogs.table_name, [
              "x_account_link_requests",
              "x_users",
            ]),
            inArray(auditLogs.operation, ["UPDATE", "CREATE"]),
          )!,
        )
        .orderBy(desc(auditLogs.created_at))
        .limit(RECENT_HISTORY_LIMIT)
    : [];

  return (
    <div>
      <AdminPageHeader
        title="X ID 連携申請"
        description="ユーザーが設定画面から送った連携申請を確認・承認します。承認すると x_users が approved 状態に更新されます。"
      />
      <AdminUserManagementTabs active="link-requests" />
      <nav
        aria-label="link_type フィルタ"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "すべて"],
            ["new", "new"],
            ["merge", "merge"],
            ["alias", "alias"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/admin/x-link-requests" : `/admin/x-link-requests?type=${key}`}
            className={`fn-btn fn-btn-sm ${linkTypeFilter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <XLinkRequestTable rows={pending} />

      {recentRejected.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            直近の却下リクエスト (上限 10)
          </h2>
          <FnTable>
            <thead>
              <tr>
                <th>申請 X ID</th>
                <th>種別</th>
                <th>申請者ユーザー ID</th>
                <th>申請日時</th>
              </tr>
            </thead>
            <tbody>
              {recentRejected.map((r) => (
                <tr key={r.id}>
                  <td>@{r.requested_x_id}</td>
                  <td>
                    <span className="fn-badge fn-badge-soft">{r.link_type ?? "new"}</span>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {r.user_id}
                  </td>
                  <td className="fn-muted">
                    {formatRelative(r.requested_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        </section>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          直近の承認/却下履歴
        </h2>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 4 }}>
          audit_logs から直近 {RECENT_HISTORY_LIMIT} 件を表示。詳細な差分は <Link href="/admin/audit?table=x_account_link_requests">監査ログ</Link> で確認できます。
        </p>
        {recentAuditLogs.length === 0 ? (
          <p className="fn-muted fn-text-sm" style={{ marginTop: 12 }}>
            履歴はまだありません。
          </p>
        ) : (
          <FnTable style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>日時</th>
                <th>テーブル</th>
                <th>操作</th>
                <th>対象 ID</th>
                <th>実行者</th>
                <th>差分サマリ</th>
              </tr>
            </thead>
            <tbody>
              {recentAuditLogs.map((h) => {
                const changed = parseAuditDiff(
                  h.before_json,
                  h.after_json,
                ).changedKeys;
                return (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div>{formatUnix(h.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {formatRelative(h.created_at)}
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{h.table_name}</td>
                    <td>
                      <span
                        className={`fn-badge ${
                          h.operation === "CREATE" ? "fn-badge-accent" : "fn-badge-soft"
                        }`}
                      >
                        {h.operation}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.target_id ? (
                        <Link
                          href={`/admin/audit?record=${encodeURIComponent(h.target_id)}`}
                        >
                          {h.target_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {h.actor_user_id ? (
                        <Link
                          href={`/admin/users/${encodeURIComponent(h.actor_user_id)}`}
                        >
                          {h.actor_user_id}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)", wordBreak: "break-all" }}>
                      {changed.slice(0, 6).join(", ")}
                      {changed.length > 6 ? ` ほか ${changed.length - 6} 件` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </FnTable>
        )}
      </section>
    </div>
  );
}
