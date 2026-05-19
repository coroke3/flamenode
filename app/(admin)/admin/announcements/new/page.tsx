import * as React from "react";
import type { Metadata } from "next";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "新規お知らせ" };
export const dynamic = "force-dynamic";

export default function AdminAnnouncementNewPage(): React.ReactElement {
  return (
    <div>
      <AdminPageHeader
        title="新規お知らせ"
        backHref="/admin/announcements"
        backLabel="お知らせ一覧へ"
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
        <AnnouncementForm mode="create" />
      </section>
    </div>
  );
}
