import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";

export const metadata: Metadata = { title: "新規お知らせ" };

export default function AdminAnnouncementNewPage(): React.ReactElement {
  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">ANNOUNCEMENT NEW</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>新規お知らせ</h1>

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

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/announcements" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> 一覧へ戻る
        </Link>
      </p>
    </div>
  );
}
