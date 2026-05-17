import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { EventForm } from "@/components/admin/EventForm";
import { DeleteEventForm } from "@/components/admin/DeleteEventForm";

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
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        EVENT EDIT
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{ev.title}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        ID: {ev.id}
      </p>

      <nav style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/admin/events/${ev.id}`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="grid" size={12} aria-hidden /> 概要
        </Link>
        <Link
          href={`/admin/events/${ev.id}/edit`}
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          <Icon name="edit" size={12} aria-hidden /> 設定編集
        </Link>
        <Link
          href={`/admin/events/${ev.id}/slots`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="clock" size={12} aria-hidden /> 枠管理
        </Link>
        <Link
          href={`/admin/events/${ev.id}/staff`}
          className="fn-btn fn-btn-ghost fn-btn-sm"
        >
          <Icon name="users" size={12} aria-hidden /> 編集権限
        </Link>
      </nav>

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
            max_slots_per_video: ev.max_slots_per_video,
            max_consecutive_slots_per_entry: ev.max_consecutive_slots_per_entry,
            slot_part_gap_minutes: ev.slot_part_gap_minutes,
            slot_type: (ev.slot_type ?? "time") as "time" | "count",
            slot_visibility_mode: (ev.slot_visibility_mode ?? "public_name") as
              | "public_name"
              | "anonymous"
              | "hidden",
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
          イベントを削除すると、紐づく枠 / 編集者 / 協力者設定が解除されます。
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
