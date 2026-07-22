import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { XLinkRequestTable } from "@/components/admin/XLinkRequestTable";
import { enrichXLinkPendingRows } from "@/lib/admin/enrichXLinkPendingRows";
import { ConsolePageHeader as ManagePageHeader } from "@/components/layout/ConsolePageHeader";
import { Icon } from "@/components/ui/Icon";
import { requireSession } from "@/lib/auth/guard";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import { users, xIdentityRequests } from "@/lib/db/schema";

export const metadata: Metadata = { title: "X ID 申請" };
export const dynamic = "force-dynamic";
const PENDING_LIMIT = 100;

export default async function ManageXLinkRequestsPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/manage/x-link-requests" });
  if (!guard.ok) return guard.element;
  const db = getDatabase();
  if (!db) notFound();
  if (!(await canManageXIdLinkRequests(db, { id: guard.user.id, role: guard.user.role ?? null }))) notFound();

  const pendingBase = await db
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
    .where(
      and(
        eq(xIdentityRequests.status, "pending"),
        inArray(xIdentityRequests.request_type, ["new_link", "existing_link"]),
      )!,
    )
    .orderBy(desc(xIdentityRequests.requested_at))
    .limit(PENDING_LIMIT);

  const pending = await enrichXLinkPendingRows(db, pendingBase, {
    includeVideoIconFallback: true,
  });

  return (
    <div>
      <ManagePageHeader
        title="X ID 申請"
        description="X ID連携申請を承認・却下します。統合操作は管理者画面に限定されます。"
        backHref="/manage"
        backLabel="イベント運営トップへ"
        accent
      >
        <span className="fn-badge fn-badge-soft"><Icon name="user" size={11} aria-hidden /> {pending.length}件</span>
      </ManagePageHeader>
      <section className="fn-console-section"><XLinkRequestTable rows={pending} /></section>
    </div>
  );
}
