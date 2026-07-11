import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { XLinkRequestTable } from "@/components/admin/XLinkRequestTable";
import { ManagePageHeader } from "@/components/manage/ManagePageHeader";
import { Icon } from "@/components/ui/Icon";
import { requireSession } from "@/lib/auth/guard";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import {
  users,
  xAccountLinkRequests,
  xUserIcons,
  xUsers,
} from "@/lib/db/schema";

export const metadata: Metadata = { title: "X ID 連携申請" };
export const dynamic = "force-dynamic";

export default async function ManageXLinkRequestsPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/manage/x-link-requests" });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const canManage = await canManageXIdLinkRequests(db, {
    id: user.id,
    role: user.role ?? null,
  });
  if (!canManage) notFound();

  const pending = await db
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
    .where(
      and(
        eq(xAccountLinkRequests.status, "pending"),
        inArray(xAccountLinkRequests.link_type, ["new", "alias"]),
      )!,
    )
    .orderBy(desc(xAccountLinkRequests.requested_at))
    .then((rows) => rows.filter((row) => row.link_type !== "merge"));

  return (
    <div>
      <ManagePageHeader
        title="X ID 連携申請"
        description="ユーザーから届いた X ID 連携申請を manage 側で承認・却下します。merge 申請は管理者画面で扱います。"
        backHref="/manage"
        backLabel="イベント運営トップへ"
        accent
      >
        <span className="fn-badge fn-badge-soft">
          <Icon name="user" size={11} aria-hidden /> {pending.length}件
        </span>
      </ManagePageHeader>

      <section className="fn-console-section">
        <XLinkRequestTable rows={pending} />
      </section>
    </div>
  );
}
