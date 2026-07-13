import * as React from "react";
import type { Metadata } from "next";
import { EventGroupForm } from "@/components/admin/EventGroupForm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { ConsolePanel } from "@/components/layout/ConsolePanel";

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

      <ConsolePanel>
        <EventGroupForm mode="create" />
      </ConsolePanel>
    </div>
  );
}
