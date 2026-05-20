import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoCollaboratorPermissions as videoCollabPermsTable,
  videoEvents as videoEventsTable,
  videoMembers,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import {
  VideoCollabPermsManager,
  type VideoCollabPermSubject,
} from "@/components/admin/VideoCollabPermsManager";
import { requireSession } from "@/lib/auth/guard";
import { canEditVideo } from "@/lib/auth/ownership";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { youtubeWatchUrl } from "@/lib/youtube/id";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getXIconCandidates } from "@/lib/db/xIconResolution";

export const metadata: Metadata = { title: "作品を編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditVideoPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const guard = await requireSession({
    next: `/dashboard/edit/${encodeURIComponent(id)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();
  const rows = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, id))
    .limit(1);
  const video = rows[0];
  if (!video) notFound();

  const memberRows = await db
    .select({
      x_user_id: videoMembers.x_user_id,
      name: videoMembers.name,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id))
    .orderBy(videoMembers.order_index);
  const initialMembers = memberRows.map((m) => ({
    name: m.name,
    x_user_id: m.x_user_id ?? "",
    role: m.role ?? "",
    comment: m.comment ?? "",
  }));
  const creatorX = video.contact_x_id || video.creator_id;
  const xRow = creatorX
    ? (
        await db
          .select()
          .from(xUsersTable)
          .where(eq(xUsersTable.id, creatorX))
          .limit(1)
      )[0]
    : null;
  const memberSuggestions = await db
    .select({ name: xUsersTable.x_name, x_user_id: xUsersTable.id })
    .from(xUsersTable)
    .orderBy(asc(xUsersTable.x_name))
    .limit(2000);
  const softwareSuggestions = await getUsedSoftwareSuggestions(db);
  // 編集対象作品の主体 X ID に紐づく候補を出す。
  // admin が他者作品を編集する場合も creator/contact 由来の候補が出る。
  const iconCandidates = creatorX ? await getXIconCandidates(db, creatorX) : [];

  // 所属イベント (video_events 経由) を取得 + 候補リストを組み立てる。
  // 候補 = (受付中のイベント) ∪ (既に紐付いているイベント) ∪ (primary_event_id)。
  // 既存所属を外せないわけではないが、UI には現状を維持できるように両方並べる。
  const currentVideoEvents = await db
    .select({ event_id: videoEventsTable.event_id })
    .from(videoEventsTable)
    .where(eq(videoEventsTable.video_id, video.id));
  const currentEventIds = currentVideoEvents.map((r) => r.event_id);
  if (video.primary_event_id && !currentEventIds.includes(video.primary_event_id)) {
    currentEventIds.push(video.primary_event_id);
  }
  const allEventRows = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.is_archived, 0));
  const acceptingEventMap = new Map<string, { id: string; title: string }>();
  for (const ev of allEventRows) {
    if (isAcceptingEntries(ev)) {
      acceptingEventMap.set(ev.id, { id: ev.id, title: ev.title });
    }
  }
  // 現在紐付いているイベントは受付状態を問わず候補に含める
  if (currentEventIds.length > 0) {
    const attached = await db
      .select({ id: eventsTable.id, title: eventsTable.title })
      .from(eventsTable)
      .where(inArray(eventsTable.id, currentEventIds));
    for (const ev of attached) acceptingEventMap.set(ev.id, ev);
  }
  const eventOptions = Array.from(acceptingEventMap.values());

  // 作品単位の参加者編集権限を subject 単位にまとめる。
  // 同じ X ID/Discord ID 内の複数 permission_key を 1 行に集約して UI に渡す。
  const videoCollabRows = await db
    .select()
    .from(videoCollabPermsTable)
    .where(eq(videoCollabPermsTable.video_id, video.id));
  const subjectMap = new Map<string, VideoCollabPermSubject>();
  for (const row of videoCollabRows) {
    const key = row.x_user_id
      ? `x:${row.x_user_id}`
      : `d:${row.discord_user_id ?? ""}`;
    const existing = subjectMap.get(key);
    if (existing) {
      existing.permission_keys.push(row.permission_key);
    } else {
      subjectMap.set(key, {
        x_user_id: row.x_user_id,
        discord_user_id: row.discord_user_id,
        display_name: row.display_name,
        permission_keys: [row.permission_key],
      });
    }
  }
  const videoCollabSubjects = Array.from(subjectMap.values());

  const xIdOptions = await db
    .select({ id: xUsersTable.id, x_name: xUsersTable.x_name })
    .from(xUsersTable)
    .where(
      and(
        eq(xUsersTable.linked_discord_user_id, user.id),
        eq(xUsersTable.approval_status, "approved"),
      )!,
    )
    .orderBy(asc(xUsersTable.x_name));

  const editUser = { id: user.id, role: user.role ?? null };
  const [
    canEditIdentity,
    canEditBasics,
    canEditYoutube,
    canEditCredits,
    canEditDescriptions,
    canEditMembers,
  ] = await Promise.all([
    canEditVideo({ db, user: editUser, video, requiredKey: "video.identity" }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.basics" }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.youtube_id" }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.credits" }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.descriptions" }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.members" }),
  ]);
  const canEditAnySection =
    canEditIdentity ||
    canEditBasics ||
    canEditYoutube ||
    canEditCredits ||
    canEditDescriptions ||
    canEditMembers;
  if (!canEditAnySection) {
    return (
      <div
        style={{
          width: "min(96%, 720px)",
          margin: "60px auto",
          padding: "48px 28px",
          background: "var(--bg-surface)",
          border: "1px solid var(--accent-warning)",
          borderRadius: "var(--radius-md)",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--accent-warning)" }}>
          編集権限がありません
        </h1>
        <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>
          この作品の作者本人、または担当イベントの運営のみが編集できます。
        </p>
        <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 8 }}>
          <Link href="/dashboard" className="fn-btn fn-btn-ghost">
            ダッシュボードへ
          </Link>
          <Link
            href={`/${video.youtube_video_id ?? video.id}`}
            className="fn-btn fn-btn-primary"
          >
            公開ページを見る
          </Link>
        </div>
      </div>
    );
  }
  const disabledSections = [
    !canEditIdentity ? "submitter" : null,
    !canEditBasics && !canEditYoutube && !canEditCredits ? "video" : null,
    !canEditDescriptions ? "descriptions" : null,
    !canEditMembers ? "members" : null,
  ].filter((v): v is string => Boolean(v));
  const disabledFields = [
    !canEditIdentity ? "submitter.display_name" : null,
    !canEditIdentity ? "submitter.icon_url" : null,
    !canEditIdentity ? "submitter.profile_text" : null,
    !canEditIdentity ? "submitter.youtube_channel_url" : null,
    !canEditIdentity ? "submitter.other_social_links" : null,
    !canEditBasics ? "video.title" : null,
    !canEditYoutube ? "video.youtube_url" : null,
    !canEditCredits ? "video.music" : null,
    !canEditCredits ? "video.credit" : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div
      style={{
        width: "min(96%, 960px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          EDIT
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          {video.title}
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          現在の状態:
          <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
            {video.status}
          </span>
          {video.youtube_video_id ? (
            <>
              {" · "}
              <a
                href={youtubeWatchUrl(video.youtube_video_id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                YouTube で確認 →
              </a>
            </>
          ) : null}
        </p>
      </header>

      <VideoForm
        mode="edit"
        videoId={video.id}
        xIdOptions={xIdOptions}
        activeXId={user.active_x_user_id ?? undefined}
        disabledSections={disabledSections}
        disabledFields={disabledFields}
        initial={{
          display_name: video.display_name,
          contact_x_id: video.contact_x_id,
          icon_url: video.icon_url ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
          title: video.title,
          youtube_url: video.youtube_video_id
            ? youtubeWatchUrl(video.youtube_video_id)
            : undefined,
          music: video.music ?? undefined,
          music_reference_url: video.music_reference_url ?? undefined,
          credit: video.credit ?? undefined,
          intro_comment: video.intro_comment ?? undefined,
          used_software: video.used_software ?? undefined,
          highlights: video.highlights ?? undefined,
          production_story: video.production_story ?? undefined,
          closing_comment: video.closing_comment ?? undefined,
          is_collab: video.submission_type === "collab",
          members: initialMembers,
          event_ids: currentEventIds,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        eventOptions={eventOptions}
        canEditEvents={canEditIdentity}
        iconCandidates={iconCandidates}
      />

      <p
        style={{
          marginTop: 18,
          color: "var(--text-muted)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="info" size={12} aria-hidden /> 編集権限はこの作品の作者と
        管理者にのみ付与されます。イベント運営は許可された項目のみ編集可能です。
      </p>

      {canEditIdentity ? (
        <section className="fn-card" style={{ marginTop: 24 }}>
          <div className="fn-card-header">
            <h2 className="fn-card-title">参加者の編集権限</h2>
          </div>
          <div className="fn-card-body">
            <VideoCollabPermsManager
              videoId={video.id}
              subjects={videoCollabSubjects}
            />
          </div>
        </section>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <Link href="/dashboard" className="fn-btn fn-btn-ghost">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
