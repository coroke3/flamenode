import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { users as usersTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { UserAdminForm } from "@/components/admin/UserAdminForm";

export const metadata: Metadata = { title: "ユーザー編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminUserEditPage({
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
    .select({ id: xUsersTable.id })
    .from(xUsersTable)
    .where(eq(xUsersTable.linked_discord_user_id, user.id));

  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">USER EDIT</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{user.name ?? user.id}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        ID: {user.id}
      </p>

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <UserAdminForm
          user={{
            id: user.id,
            role: (user.role ?? "user") as "user" | "admin" | "moderator",
            is_banned: user.is_banned ?? 0,
            is_notification_enabled: user.is_notification_enabled ?? 1,
          }}
          xUserIds={xIds.map((x) => x.id)}
        />
      </section>

      <p style={{ marginTop: 22, display: "flex", gap: 8 }}>
        <Link
          href={`/admin/users/${user.id}`}
          className="fn-btn fn-btn-ghost"
        >
          <Icon name="chevron-left" size={12} aria-hidden /> 詳細へ戻る
        </Link>
        <Link href="/admin/users" className="fn-btn fn-btn-ghost">
          ユーザー管理へ
        </Link>
      </p>
    </div>
  );
}
