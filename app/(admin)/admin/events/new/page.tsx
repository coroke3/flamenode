import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { EventForm } from "@/components/admin/EventForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "新規イベント作成" };
export const dynamic = "force-dynamic";

export default function AdminNewEventPage(): React.ReactElement {
  return (
    <div>
      <AdminPageHeader
        title="新規イベント作成"
        description="イベント本体を作成します。スロットとイベント管理者は作成後に追加します。"
        backHref="/admin/events"
        backLabel="イベント一覧へ"
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
        <EventForm mode="create" />
      </section>

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/events" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント管理に戻る
        </Link>
      </p>
    </div>
  );
}
