import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  users as usersTable,
  videos as videosTable,
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

  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">USER</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{user.name ?? user.id}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        ID: {user.id} / {user.email ?? "email 未取得"} / 登録{" "}
        {formatRelative(user.created_at)}
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
      </p>
    </div>
  );
}
