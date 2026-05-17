import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs as historyLogsTable,
  users as usersTable,
  videos as videosTable,
  xAccountLinkRequests as xAccountLinkRequestsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix, formatRelative } from "@/lib/utils/format";

export const metadata: Metadata = { title: "ユーザー詳細" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const user = (
    await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1)
  )[0];
  if (!user) notFound();

  const xIds = await db
    .select()
    .from(xUsersTable)
    .where(eq(xUsersTable.linked_discord_user_id, user.id));

  const recentVideos = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      status: videosTable.status,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .where(eq(videosTable.owner_discord_user_id, user.id))
    .orderBy(desc(videosTable.created_at))
    .limit(20);

  // 当該ユーザーが操作した管理アクション + 当該ユーザーに対する管理アクション
  // operator_discord_id か record_id が user.id に一致するものを取得
  const recentByOperator = await db
    .select()
    .from(historyLogsTable)
    .where(eq(historyLogsTable.operator_discord_id, user.id))
    .orderBy(desc(historyLogsTable.created_at))
    .limit(15);
  const recentOnUser = await db
    .select()
    .from(historyLogsTable)
    .where(eq(historyLogsTable.record_id, user.id))
    .orderBy(desc(historyLogsTable.created_at))
    .limit(15);

  // X ID 連携申請履歴 (このユーザーが申請したもの)
  const linkRequests = await db
    .select({
      id: xAccountLinkRequestsTable.id,
      requested_x_id: xAccountLinkRequestsTable.requested_x_id,
      link_type: xAccountLinkRequestsTable.link_type,
      target_x_user_id: xAccountLinkRequestsTable.target_x_user_id,
      status: xAccountLinkRequestsTable.status,
      requested_at: xAccountLinkRequestsTable.requested_at,
    })
    .from(xAccountLinkRequestsTable)
    .where(eq(xAccountLinkRequestsTable.discord_user_id, user.id))
    .orderBy(desc(xAccountLinkRequestsTable.requested_at))
    .limit(10);

  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">USER</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{user.name ?? user.id}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        ID: {user.id} / {user.email ?? "email 未取得"} / 登録{" "}
        {formatRelative(user.created_at)}
        {user.emailVerified ? (
          <>
            {" "}/ email認証 {formatRelative(Math.floor((user.emailVerified as Date).getTime() / 1000))}
          </>
        ) : null}
      </p>

      <section className="fn-card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          権限と状態
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span
            className={`fn-badge ${
              user.role === "admin"
                ? "fn-badge-accent"
                : user.role === "moderator"
                  ? "fn-badge-warning"
                  : "fn-badge-soft"
            }`}
          >
            role: {user.role ?? "user"}
          </span>
          <span className={`fn-badge ${user.is_banned === 1 ? "fn-badge-danger" : "fn-badge-soft"}`}>
            BAN: {user.is_banned === 1 ? "ON" : "OFF"}
          </span>
          <span className="fn-badge fn-badge-soft">
            通知: {user.is_notification_enabled === 1 ? "有効" : "停止"}
          </span>
          <span className="fn-badge fn-badge-soft">
            Active X: {user.active_x_user_id ? `@${user.active_x_user_id}` : "-"}
          </span>
          <span
            className={`fn-badge ${user.emailVerified ? "fn-badge-accent" : "fn-badge-warning"}`}
          >
            email 認証: {user.emailVerified ? "済" : "未"}
          </span>
          <span
            className={`fn-badge ${user.is_tos_accepted === 1 ? "fn-badge-accent" : "fn-badge-danger"}`}
          >
            TOS: {user.is_tos_accepted === 1 ? "同意済" : "未同意"}
          </span>
          {user.terms_reaccept_required === 1 ? (
            <span className="fn-badge fn-badge-warning">再同意要求中</span>
          ) : null}
        </div>
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          連携 X ID ({xIds.length})
        </h2>
        {xIds.length === 0 ? (
          <p className="fn-muted fn-text-sm">未連携です。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>X ID</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {xIds.map((x) => (
                <tr key={x.id}>
                  <td>{x.x_name}</td>
                  <td>@{x.id}</td>
                  <td>
                    {x.approval_status === "approved" ? (
                      <span className="fn-badge fn-badge-accent">承認</span>
                    ) : x.approval_status === "pending" ? (
                      <span className="fn-badge fn-badge-warning">待ち</span>
                    ) : (
                      <span className="fn-badge fn-badge-danger">却下</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/user/${x.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
                      プロフィール
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          投稿作品 ({recentVideos.length})
        </h2>
        {recentVideos.length === 0 ? (
          <p className="fn-muted fn-text-sm">投稿はありません。</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {recentVideos.map((v) => (
              <li
                key={v.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span className="fn-badge fn-badge-soft">{v.status}</span>
                <Link href={`/admin/videos/${v.id}`} style={{ flex: 1, color: "var(--text-primary)" }}>
                  {v.title}
                </Link>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatUnix(v.created_at, { dateOnly: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          X ID 連携申請履歴 ({linkRequests.length})
        </h2>
        {linkRequests.length === 0 ? (
          <p className="fn-muted fn-text-sm">申請はありません。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>申請 X ID</th>
                <th>種別</th>
                <th>target</th>
                <th>状態</th>
                <th>申請日時</th>
              </tr>
            </thead>
            <tbody>
              {linkRequests.map((r) => (
                <tr key={r.id}>
                  <td>@{r.requested_x_id}</td>
                  <td>
                    <span
                      className={`fn-badge ${
                        r.link_type === "merge"
                          ? "fn-badge-danger"
                          : r.link_type === "alias"
                            ? "fn-badge-warning"
                            : "fn-badge-soft"
                      }`}
                    >
                      {r.link_type ?? "new"}
                    </span>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {r.target_x_user_id ?? "—"}
                  </td>
                  <td>
                    <span
                      className={`fn-badge ${
                        r.status === "approved"
                          ? "fn-badge-accent"
                          : r.status === "rejected"
                            ? "fn-badge-danger"
                            : "fn-badge-warning"
                      }`}
                    >
                      {r.status ?? "pending"}
                    </span>
                  </td>
                  <td className="fn-muted" style={{ fontSize: 11 }}>
                    {formatRelative(r.requested_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          このユーザーへの管理操作 (record_id 一致)
        </h2>
        {recentOnUser.length === 0 ? (
          <p className="fn-muted fn-text-sm">該当する履歴はありません。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>テーブル</th>
                <th>操作</th>
                <th>実行者</th>
              </tr>
            </thead>
            <tbody>
              {recentOnUser.map((h) => (
                <tr key={h.id}>
                  <td className="fn-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRelative(h.created_at)}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{h.table_name}</td>
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
                  <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {h.operator_discord_id ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          このユーザーが実行した管理操作 (operator 一致)
        </h2>
        {recentByOperator.length === 0 ? (
          <p className="fn-muted fn-text-sm">該当する履歴はありません。</p>
        ) : (
          <table className="fn-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>テーブル</th>
                <th>操作</th>
                <th>レコード</th>
              </tr>
            </thead>
            <tbody>
              {recentByOperator.map((h) => (
                <tr key={h.id}>
                  <td className="fn-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatRelative(h.created_at)}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{h.table_name}</td>
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
                  <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Link href={`/admin/audit?record=${encodeURIComponent(h.record_id)}`}>
                      {h.record_id}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: 24, display: "flex", gap: 8 }}>
        <Link href="/admin/users" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> ユーザー管理へ戻る
        </Link>
        <Link
          href={`/admin/users/${user.id}/edit`}
          className="fn-btn fn-btn-primary"
        >
          <Icon name="edit" size={12} aria-hidden /> 編集
        </Link>
        <Link
          href={`/admin/audit?operator=${encodeURIComponent(user.id)}`}
          className="fn-btn fn-btn-ghost"
        >
          すべての操作履歴
        </Link>
      </p>
    </div>
  );
}
