import * as React from "react";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { xAccountLinkRequests } from "@/lib/db/schema";
import { XLinkRequestTable } from "@/components/admin/XLinkRequestTable";

export const metadata: Metadata = { title: "X ID 連携申請" };
export const dynamic = "force-dynamic";

export default async function AdminXLinkRequestsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const pending = db
    ? await db
        .select({
          id: xAccountLinkRequests.id,
          requested_x_id: xAccountLinkRequests.requested_x_id,
          discord_user_id: xAccountLinkRequests.discord_user_id,
          requested_at: xAccountLinkRequests.requested_at,
        })
        .from(xAccountLinkRequests)
        .where(eq(xAccountLinkRequests.status, "pending"))
        .orderBy(desc(xAccountLinkRequests.requested_at))
    : [];

  return (
    <div>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>X ID 連携申請</h1>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
          ユーザーが設定画面から送った連携申請を承認すると、
          <code> x_users </code>
          にレコードが作成されダッシュボードの一覧に表示されます。
        </p>
      </header>
      <XLinkRequestTable rows={pending} />
    </div>
  );
}
