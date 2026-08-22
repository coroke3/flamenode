import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { announcements } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { DeleteAnnouncementForm } from "@/components/admin/DeleteAnnouncementForm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { ConsolePanel } from "@/components/layout/ConsolePanel";

export const metadata: Metadata = { title: "お知らせ編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminAnnouncementEditPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();
  const row = (
    await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
  )[0];
  if (!row) notFound();

  return (
    <div>
      <AdminPageHeader
        title={`${row.title} を編集`}
        backHref="/admin/announcements"
        backLabel="お知らせ一覧へ"
        actions={[
          {
            href: `/admin/audit?table=announcements&record=${encodeURIComponent(row.id)}`,
            label: "監査ログ",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
        ]}
      />

      <ConsolePanel>
        <AnnouncementForm
          mode="edit"
          initial={{
            id: row.id,
            base_updated_at: row.updated_at,
            title: row.title,
            body: row.body,
            severity: (row.severity ?? "info") as "info" | "warning" | "danger",
            target_audience: (row.target_audience ?? "all") as
              | "all"
              | "creators"
              | "admins",
            is_published: row.is_published ?? 0,
            publish_at: row.publish_at,
            expire_at: row.expire_at,
          }}
        />
      </ConsolePanel>

      <ConsolePanel title="削除" tone="danger" separated compact>
        <DeleteAnnouncementForm id={row.id} />
      </ConsolePanel>
    </div>
  );
}
