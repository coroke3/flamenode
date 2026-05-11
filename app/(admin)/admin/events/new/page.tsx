import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { EventForm } from "@/components/admin/EventForm";

export const metadata: Metadata = { title: "新規イベント作成" };

export default function AdminNewEventPage(): React.ReactElement {
  return (
    <div>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        EVENT NEW
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>新規イベント作成</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        イベント本体を作成します。スロット、運営メンバー、協力者は作成後の編集ページから追加します。
      </p>

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
