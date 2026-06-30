import * as React from "react";
import type { Metadata } from "next";
import { EventGroupForm } from "@/components/admin/EventGroupForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "新規イベントグループ" };
export const dynamic = "force-dynamic";

export default function AdminEventGroupNewPage(): React.ReactElement {
  return (
    <div>
      <AdminPageHeader
        title="新規イベントグループ"
        backHref="/admin/event-groups"
        backLabel="グループ一覧へ"
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
        <EventGroupForm mode="create" />
      </section>
    </div>
  );
}
