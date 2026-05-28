import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { EventForm } from "@/components/admin/EventForm";
import { DeleteEventForm } from "@/components/admin/DeleteEventForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "イベント編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventEditPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();
  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  return (
    <div>
      <AdminPageHeader
        title={`${ev.title} を編集`}
        description={`ID: ${ev.id}`}
        backHref={`/admin/events/${ev.id}`}
        backLabel="イベント詳細へ"
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
        <EventForm
          mode="edit"
          initial={{
            id: ev.id,
            title: ev.title,
            event_type: (ev.event_type ?? "event") as
              | "event"
              | "collabo"
              | "type"
              | "other",
            explanation: ev.explanation,
            icon_url: ev.icon_url,
            img_url: ev.img_url,
            accent_color: ev.accent_color,
            start_time: ev.start_time,
            end_time: ev.end_time,
            entry_start_time: ev.entry_start_time,
            entry_end_time: ev.entry_end_time,
            is_active: ev.is_active,
            is_entry_open: ev.is_entry_open,
            is_archived: ev.is_archived,
            allow_user_video_event_links: ev.allow_user_video_event_links,
            allow_user_video_edits: ev.allow_user_video_edits,
            user_video_edit_permission_keys_json:
              ev.user_video_edit_permission_keys_json,
            video_form_settings_json: ev.video_form_settings_json,
            max_slots_per_video: ev.max_slots_per_video,
            max_consecutive_slots_per_entry: ev.max_consecutive_slots_per_entry,
            slot_part_gap_minutes: ev.slot_part_gap_minutes,
            slot_type: (ev.slot_type ?? "time") as "time" | "count",
            slot_visibility_mode: (ev.slot_visibility_mode ?? "public_name") as
              | "public_name"
              | "anonymous"
              | "hidden",
            parts_json: ev.parts_json,
          }}
        />
      </section>

      <section
        style={{
          marginTop: 22,
          padding: "18px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--accent-danger)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-danger)" }}>
          危険操作
        </h2>
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
          イベントを削除すると、紐づく枠 / イベント管理者設定が解除されます。
          作品本体は残ります (primary_event_id が空になる場合があります)。
        </p>
        <DeleteEventForm eventId={ev.id} />
      </section>

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/events" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント管理へ
        </Link>
      </p>
    </div>
  );
}
