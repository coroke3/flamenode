import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { announcements } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { DeleteAnnouncementForm } from "@/components/admin/DeleteAnnouncementForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

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

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <AnnouncementForm
          mode="edit"
          initial={{
            id: row.id,
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
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "16px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--accent-danger)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-danger)" }}>
          削除
        </h2>
        <DeleteAnnouncementForm id={row.id} />
      </section>

    </div>
  );
}
