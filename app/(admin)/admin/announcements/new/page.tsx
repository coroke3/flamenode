import * as React from "react";
import type { Metadata } from "next";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { ConsolePanel } from "@/components/layout/ConsolePanel";

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

      <ConsolePanel>
        <AnnouncementForm mode="create" />
      </ConsolePanel>
    </div>
  );
}
