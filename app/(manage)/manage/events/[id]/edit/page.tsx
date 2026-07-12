import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import { canEditEvent } from "@/lib/auth/ownership";
import { events as eventsTable } from "@/lib/db/schema";
import { loadStagePermissionFormSettingsJson } from "@/lib/video/stagePermissionQuestions";
import { EventForm } from "@/components/admin/EventForm";
import { DeleteEventForm } from "@/components/admin/DeleteEventForm";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import { ManagePageHeader } from "@/components/manage/ManagePageHeader";
import { Icon } from "@/components/ui/Icon";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";

export const metadata: Metadata = { title: "イベント設定" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ManageEventEditPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/edit`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const videoFormSettingsJson = await loadStagePermissionFormSettingsJson(db, id);

  const eventEditor = { id: user.id, role: user.role ?? null };
  const [canManageBasic, canManagePublish, canManageQuestions, canManageSlots] =
    await Promise.all([
      canEditEvent(db, eventEditor, id, "event.basic"),
      canEditEvent(db, eventEditor, id, "event.publish"),
      canEditEvent(db, eventEditor, id, "event.questions"),
      canEditEvent(db, eventEditor, id, "event.slots"),
    ]);
  if (
    !canManageBasic &&
    !canManagePublish &&
    !canManageQuestions &&
    !canManageSlots
  ) {
    notFound();
  }

  const isAdmin = user.role === "admin";

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <ManageActiveXNotice
        userId={user.id}
        activeXUserId={user.active_x_user_id}
      />
      <ManagePageHeader
        title={`${ev.title} イベント設定`}
        description={`ID: ${ev.id}`}
        backHref={`/manage/events/${ev.id}`}
        backLabel="イベント運営トップへ"
        accent
      />
      <ManageEventTabs eventId={ev.id} active="edit" isAdmin={isAdmin} />

      <section className="fn-console-section">
        <EventForm
          mode="edit"
          editableSections={{
            basic: canManageBasic,
            publish: canManagePublish,
            questions: canManageQuestions,
            slots: canManageSlots,
          }}
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
            visibility_status: ev.visibility_status,
            allow_user_video_event_links: ev.allow_user_video_event_links,
            allow_unslotted_posts: ev.allow_unslotted_posts,
            allow_user_video_edits: ev.allow_user_video_edits,
            user_video_edit_permission_keys_json:
              ev.user_video_edit_permission_keys_json,
            video_form_settings_json: videoFormSettingsJson,
            max_slots_per_video: ev.max_slots_per_video,
            max_consecutive_slots_per_entry:
              ev.max_consecutive_slots_per_entry,
            slot_part_gap_minutes: ev.slot_part_gap_minutes,
            slot_type: (ev.slot_type ?? "time") as "time" | "count",
            slot_visibility_mode: (ev.slot_visibility_mode ??
              "public_name") as "public_name" | "anonymous" | "hidden",
            parts_json: ev.parts_json,
            editable_fields: ev.editable_fields,
            review_settings: ev.review_settings,
          }}
        />
      </section>

      {isAdmin ? (
        <section
          className="fn-console-section"
          style={{ borderColor: "var(--accent-danger)" }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--accent-danger)",
            }}
          >
            危険操作
          </h2>
          <p className="fn-muted fn-text-sm">
            イベントを削除すると、募集枠・イベント管理設定が停止されます。作品本体は残ります。
          </p>
          <DeleteEventForm eventId={ev.id} redirectHref="/manage" />
        </section>
      ) : null}

      <p style={{ marginTop: 16 }}>
        <Link href={`/manage/events/${ev.id}`} className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント運営トップへ
        </Link>
      </p>
    </div>
  );
}
