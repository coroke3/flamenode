import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { users as usersTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { UserAdminForm } from "@/components/admin/UserAdminForm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserTabs } from "@/components/admin/AdminUserTabs";

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
    .where(eq(xUsersTable.linked_user_id, user.id));

  return (
    <div>
      <AdminPageHeader
        title={`${user.name ?? user.id} を編集`}
        description={`ID: ${user.id}`}
        backHref={`/admin/users/${user.id}`}
        backLabel="ユーザー詳細へ"
      />
      <AdminUserTabs userId={user.id} active="edit" />

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
            can_create_events: user.can_create_events ?? 0,
            is_notification_enabled: user.is_notification_enabled ?? 1,
          }}
          xUserIds={xIds.map((x) => x.id)}
        />
      </section>

    </div>
  );
}
