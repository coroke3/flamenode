import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs as historyLogsTable,
  users as usersTable,
  videoInteractions as videoInteractionsTable,
  videos as videosTable,
  xAccountLinkRequests as xAccountLinkRequestsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminUserTabs } from "@/components/admin/AdminUserTabs";

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
      status: videosTable.visibility_status,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .where(eq(videosTable.submitted_by_discord_user_id, user.id))
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

  // Active X ID のライブラリ件数 (like/bookmark)
  let likeCount = 0;
  let bookmarkCount = 0;
  if (user.active_x_user_id) {
    const rows = await db
      .select({
        interaction_type: videoInteractionsTable.interaction_type,
        c: sql<number>`COUNT(*)`,
      })
      .from(videoInteractionsTable)
      .where(eq(videoInteractionsTable.x_user_id, user.active_x_user_id))
      .groupBy(videoInteractionsTable.interaction_type);
    for (const r of rows) {
      const c = Number(r.c ?? 0);
      if (r.interaction_type === "like") likeCount = c;
      if (r.interaction_type === "bookmark") bookmarkCount = c;
    }
  }
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
      <AdminPageHeader
        title={user.name ?? user.id}
        description={`ID: ${user.id} / ${user.email ?? "email 未取得"} / 登録 ${formatRelative(user.created_at)}`}
        backHref="/admin/users"
        backLabel="ユーザー管理へ"
      />
      <AdminUserTabs userId={user.id} active="detail" />
      {user.emailVerified ? (
        <p className="fn-console-note">
          email認証 {formatRelative(user.emailVerified)}
        </p>
      ) : null}

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">IDの主体整理</h2>
        <div className="fn-console-kv-grid">
          <div>
            <p className="fn-muted fn-text-xs fn-bold">Discord / Auth 主体</p>
            <p className="fn-console-kv-value fn-console-kv-value--mono">
              {user.discord_id ?? user.id}
            </p>
            <p className="fn-muted fn-text-sm fn-console-kv-value">
              ログイン、BAN、TOS、通知、管理権限の主体。
            </p>
          </div>
          <div>
            <p className="fn-muted fn-text-xs fn-bold">Active X ID</p>
            <p className="fn-console-kv-value fn-console-kv-value--mono">
              {user.active_x_user_id ? `@${user.active_x_user_id}` : "未設定"}
            </p>
            <p className="fn-muted fn-text-sm fn-console-kv-value">
              作品一覧、いいね、セーブ、ライブラリの現在の操作主体。
            </p>
          </div>
          <div>
            <p className="fn-muted fn-text-xs fn-bold">紐づく X ID</p>
            <p className="fn-console-kv-value fn-console-kv-value--bold">
              {xIds.length} 件
            </p>
            <p className="fn-muted fn-text-sm fn-console-kv-value">
              作者、プロフィール、アイコン、公開表示の主体。
            </p>
          </div>
        </div>
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">権限と状態</h2>
        <div className="fn-console-badge-row">
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
          {user.active_x_user_id ? (
            <>
              <span className="fn-badge fn-badge-soft">
                Active X ライク: {likeCount}
              </span>
              <span className="fn-badge fn-badge-soft">
                Active X ブックマーク: {bookmarkCount}
              </span>
            </>
          ) : null}
        </div>
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">連携 X ID ({xIds.length})</h2>
        {xIds.length === 0 ? (
          <p className="fn-muted fn-text-sm">未連携です。</p>
        ) : (
          <div className="fn-console-xid-grid">
            {xIds.map((x, index) => (
              <section
                key={`${x.id}-user-xid-${index}`}
                className={`fn-console-xid-card ${
                  x.id === user.active_x_user_id
                    ? "fn-console-xid-card--active"
                    : ""
                }`}
              >
                <div>
                  <strong>{x.x_name}</strong>
                  <div className="fn-muted fn-text-sm">@{x.id}</div>
                </div>
                <div className="fn-console-badge-row">
                  {x.id === user.active_x_user_id ? (
                    <span className="fn-badge fn-badge-soft">Active</span>
                  ) : null}
                  {x.approval_status === "approved" ? (
                    <span className="fn-badge fn-badge-accent">承認</span>
                  ) : x.approval_status === "pending" ? (
                    <span className="fn-badge fn-badge-warning">待ち</span>
                  ) : (
                    <span className="fn-badge fn-badge-danger">却下</span>
                  )}
                </div>
                <Link href={`/user/${x.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
                  Xプロフィールを確認
                </Link>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">投稿作品 ({recentVideos.length})</h2>
        {recentVideos.length === 0 ? (
          <p className="fn-muted fn-text-sm">投稿はありません。</p>
        ) : (
          <ul className="fn-console-list">
            {recentVideos.map((v, index) => (
              <li
                key={`${v.id}-recent-video-${index}`}
                className="fn-console-list-item"
              >
                <span className="fn-badge fn-badge-soft">{v.status}</span>
                <Link href={`/admin/videos/${v.id}`} className="fn-console-list-link">
                  {v.title}
                </Link>
                <span className="fn-td-muted">
                  {formatUnix(v.created_at, { dateOnly: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">
          X ID 連携申請履歴 ({linkRequests.length})
        </h2>
        {linkRequests.length === 0 ? (
          <p className="fn-muted fn-text-sm">申請はありません。</p>
        ) : (
          <FnTable>
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
                  <td className="fn-td-mono">{r.target_x_user_id ?? "—"}</td>
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
                  <td className="fn-muted fn-td-muted">
                    {formatRelative(r.requested_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">
          このユーザーへの管理操作 (record_id 一致)
        </h2>
        {recentOnUser.length === 0 ? (
          <p className="fn-muted fn-text-sm">該当する履歴はありません。</p>
        ) : (
          <FnTable>
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
                  <td className="fn-muted fn-td-nowrap">
                    {formatRelative(h.created_at)}
                  </td>
                  <td className="fn-td-mono">{h.table_name}</td>
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
                  <td className="fn-td-secondary">
                    {h.operator_discord_id ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>

      <section className="fn-card fn-console-card">
        <h2 className="fn-console-card-title">
          このユーザーが実行した管理操作 (operator 一致)
        </h2>
        {recentByOperator.length === 0 ? (
          <p className="fn-muted fn-text-sm">該当する履歴はありません。</p>
        ) : (
          <FnTable>
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
                  <td className="fn-muted fn-td-nowrap">
                    {formatRelative(h.created_at)}
                  </td>
                  <td className="fn-td-mono">{h.table_name}</td>
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
                  <td className="fn-td-mono fn-td-ellipsis">
                    {h.record_id ? (
                      <Link
                        href={`/admin/audit?record=${encodeURIComponent(h.record_id)}`}
                      >
                        {h.record_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </FnTable>
        )}
      </section>
    </div>
  );
}
