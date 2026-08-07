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
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { Icon } from "@/components/ui/Icon";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { getEventPendingReviewVideoCount } from "@/lib/manage/pendingReviewVideos";

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

  const videoFormSettingsJson = await loadStagePermissionFormSettingsJson(db, id);
  const editor = { id: user.id, role: user.role ?? null };
  const [canManageBasic, canManagePublish, canManageQuestions, canManageSlots] =
    await Promise.all([
      canEditEvent(db, editor, id, "event.basic"),
      canEditEvent(db, editor, id, "event.publish"),
      canEditEvent(db, editor, id, "event.questions"),
      canEditEvent(db, editor, id, "event.slots"),
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
  const pendingCount = await getEventPendingReviewVideoCount(id);
  return (
    <ManageEventPageShell
      eventId={event.id}
      title={event.title}
      description="イベントの基本設定・公開・投稿フォーム・枠ルールを編集します。"
      backHref={`/manage/events/${event.id}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(event.accent_color)}
      showActiveXNotice={!isAdmin}
      userId={user.id}
      activeXUserId={user.active_x_user_id}
    >
      <section className="manage-slot-quicklink" aria-label="枠設定へのショートカット">
        <div>
          <strong>イベント枠を設定する</strong>
          <p>募集枠の生成・整理・予約状況の管理は、枠設定画面から行えます。</p>
        </div>
        <Link href={`/manage/events/${event.id}/slots`} className="fn-btn fn-btn-primary">
          枠設定を開く
          <Icon name="chevron-right" size={14} aria-hidden />
        </Link>
      </section>

      <section className="manage-section">
        <EventForm
          mode="edit"
          variant="manage"
          draftAuthUserId={user.id}
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
            video_form_settings_json: videoFormSettingsJson,
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
        <section className="manage-section fn-console-panel fn-console-panel--danger">
          <h2 className="fn-console-panel-title" style={{ color: "var(--accent-danger)" }}>
            危険操作
          </h2>
          <p className="fn-muted fn-text-sm">
            イベントを非公開にすると、公開ページと新規募集を停止します。枠・運営設定・作品との紐付けは保持されます。
          </p>
          <DeleteEventForm eventId={event.id} redirectHref="/manage" />
        </section>
      ) : null}
    </ManageEventPageShell>
  );
}
