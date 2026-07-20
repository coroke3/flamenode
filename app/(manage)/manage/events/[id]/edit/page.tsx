import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import { canEditEvent } from "@/lib/auth/ownership";
import {
  eventCustomQuestions,
  events as eventsTable,
} from "@/lib/db/schema";
import { rowToQuestion } from "@/lib/video/customQuestions";
import { EventForm } from "@/components/admin/EventForm";
import { DeleteEventForm } from "@/components/admin/DeleteEventForm";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import { ConsolePageHeader as ManagePageHeader } from "@/components/layout/ConsolePageHeader";
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

  const event = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!event) notFound();

  const customQuestions = await db
    .select()
    .from(eventCustomQuestions)
    .where(and(
      eq(eventCustomQuestions.event_id, id),
      eq(eventCustomQuestions.is_active, 1),
    )!)
    .orderBy(
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.question_key),
    );

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
    <div style={manageEventAccentStyle(event.accent_color)}>
      <ManageActiveXNotice
        userId={user.id}
        activeXUserId={user.active_x_user_id}
      />
      <ManagePageHeader
        title={`${event.title} イベント設定`}
        description={`ID: ${event.id}`}
        backHref={`/manage/events/${event.id}`}
        backLabel="イベント運営トップへ"
        accent
      />
      <ManageEventTabs eventId={event.id} isAdmin={isAdmin} />

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
            id: event.id,
            title: event.title,
            event_type: (event.event_type ?? "event") as
              | "event"
              | "collabo"
              | "type"
              | "other",
            explanation: event.explanation,
            icon_url: event.icon_url,
            img_url: event.img_url,
            accent_color: event.accent_color,
            start_time: event.start_time,
            end_time: event.end_time,
            entry_start_time: event.entry_start_time,
            entry_end_time: event.entry_end_time,
            visibility_status: event.visibility_status,
            allow_user_video_event_links: event.allow_user_video_event_links,
            allow_unslotted_posts: event.allow_unslotted_posts,
            allow_user_video_edits: event.allow_user_video_edits,
            user_video_edit_permission_keys_json:
              event.user_video_edit_permission_keys_json,
            custom_questions: customQuestions.map((question) => {
              const parsed = rowToQuestion(question);
              const { event_id: _eventId, ...editable } = parsed;
              return editable;
            }),
            max_slots_per_video: event.max_slots_per_video,
            slot_part_gap_minutes: event.slot_part_gap_minutes,
            slot_type: (event.slot_type ?? "time") as "time" | "count",
            slot_visibility_mode: (event.slot_visibility_mode ??
              "public_name") as "public_name" | "anonymous" | "hidden",
            parts_json: event.parts_json,
            editable_fields: event.editable_fields,
            review_settings: event.review_settings,
          }}
        />
      </section>

      {isAdmin ? (
        <section
          className="fn-console-section"
          style={{ borderColor: "var(--accent-danger)" }}
        >
          <h2 style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--accent-danger)",
          }}>
            危険操作
          </h2>
          <p className="fn-muted fn-text-sm">
            イベントを非公開にすると、公開ページと新規募集を停止します。枠・運営設定・作品との紐付けは保持されます。
          </p>
          <DeleteEventForm eventId={event.id} redirectHref="/manage" />
        </section>
      ) : null}

      <p style={{ marginTop: 16 }}>
        <Link href={`/manage/events/${event.id}`} className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント運営トップへ
        </Link>
      </p>
    </div>
  );
}
