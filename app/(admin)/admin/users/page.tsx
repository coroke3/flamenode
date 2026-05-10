import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, like, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { users as usersTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "ユーザー管理" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}): Promise<React.ReactElement> {
  const { q = "", status = "" } = await searchParams;
  const db = getDatabase();

  let userRows: (typeof usersTable.$inferSelect)[] = [];
  if (db) {
    try {
      const filters = q
        ? [
            or(
              like(usersTable.name, `%${q}%`),
              like(usersTable.email, `%${q}%`),
              eq(usersTable.id, q),
            ),
          ]
        : [];
      userRows = await db
        .select()
        .from(usersTable)
        .where(filters[0])
        .orderBy(desc(usersTable.created_at))
        .limit(80);
    } catch (e) {
      console.error("[AdminUsersPage] fetch failed", e);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>ユーザー管理</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        Discord アカウントを軸に、X ID 連携・BAN 状態・管理権限を管理します。
      </p>

      <form
        method="get"
        style={{
          marginTop: 18,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="名前 / メール / ID で検索"
          className="fn-input"
          style={{ maxWidth: 320 }}
        />
        <select name="status" className="fn-select" defaultValue={status}>
          <option value="">すべて</option>
          <option value="active">通常</option>
          <option value="banned">BAN</option>
          <option value="admin">管理者</option>
        </select>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          検索
        </button>
      </form>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>X ID</th>
            <th>権限</th>
            <th>登録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {userRows.map((u) => (
            <tr key={u.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {u.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={u.image}
                      alt=""
                      width={28}
                      height={28}
                      style={{ borderRadius: 999, objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Icon name="user" size={12} aria-hidden />
                    </span>
                  )}
                  <div>
                    <div>{u.name ?? "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {u.id.slice(0, 12)}…
                    </div>
                  </div>
                </div>
              </td>
              <td>{u.active_x_user_id ? `@${u.active_x_user_id}` : "—"}</td>
              <td>
                {u.is_banned === 1 ? (
                  <span className="fn-badge fn-badge-danger">BAN</span>
                ) : u.role === "admin" ? (
                  <span className="fn-badge fn-badge-accent">ADMIN</span>
                ) : u.role === "moderator" ? (
                  <span className="fn-badge fn-badge-warning">MOD</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">USER</span>
                )}
              </td>
              <td>{formatRelative(u.created_at)}</td>
              <td>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                >
                  詳細
                </Link>
              </td>
            </tr>
          ))}
          {userRows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  対象ユーザーが見つかりません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
