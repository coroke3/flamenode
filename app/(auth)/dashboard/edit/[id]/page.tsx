import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoEvents as videoEventsTable,
  videoMembers,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { VideoEditPermissionSummary } from "@/components/video/VideoEditPermissionSummary";
import {
  computeEditPermissionSummary,
  loadVideoCollabSubjects,
} from "@/lib/video/collabPerms";
import { requireSession } from "@/lib/auth/guard";
import { VideoForm } from "@/components/forms/VideoForm";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import { Icon } from "@/components/ui/Icon";
import { youtubeWatchUrl } from "@/lib/youtube/id";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import {
  fetchActiveCustomQuestionsForEvents,
  readCustomAnswerValuesForVideo,
} from "@/lib/video/customQuestionAnswers";
import {
  computeAllowedVideoEditSections,
  hasAnyVideoEditSection,
} from "@/lib/video/computeEditSections";

export const metadata: Metadata = { title: "作品を編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ privileged?: string }>;
}

type PrivilegeMode = "normal" | "admin" | "event";

function normalizePrivilegeMode(raw: string | undefined): PrivilegeMode {
  return raw === "admin" || raw === "event" ? raw : "normal";
}

function PrivilegeModeBanner({
  mode,
  isAdmin,
  canOfferEventMode,
  videoId,
}: {
  mode: PrivilegeMode;
  isAdmin: boolean;
  canOfferEventMode: boolean;
  videoId: string;
}): React.ReactElement {
  const base = `/dashboard/edit/${encodeURIComponent(videoId)}`;
  if (mode === "admin") {
    return (
      <div role="status" className="fn-privilege-banner fn-privilege-banner--admin">
        <Icon name="alert" size={12} aria-hidden />
        管理者権限で編集中。提出主体や所属イベントの変更が可能です。
        <span className="fn-privilege-banner-actions">
          {canOfferEventMode ? (
            <Link
              href={`${base}?privileged=event`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              イベント運営権限で編集
            </Link>
          ) : null}
          <Link href={base} className="fn-btn fn-btn-ghost fn-btn-sm">
            通常モードへ戻る
          </Link>
        </span>
      </div>
    );
  }
  if (mode === "event") {
    return (
      <div role="status" className="fn-privilege-banner fn-privilege-banner--event">
        <Icon name="users" size={12} aria-hidden />
        イベント運営権限で編集中。
        <span className="fn-privilege-banner-actions">
          {isAdmin ? (
            <Link
              href={`${base}?privileged=admin`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              管理者権限で編集
            </Link>
          ) : null}
          <Link href={base} className="fn-btn fn-btn-ghost fn-btn-sm">
            通常モードへ戻る
          </Link>
        </span>
      </div>
    );
  }
  return (
    <div role="status" className="fn-privilege-banner fn-privilege-banner--normal">
      <Icon name="info" size={11} aria-hidden /> 通常編集モード（作品オーナー / 合作メンバーの権限のみ）
      <span className="fn-privilege-banner-actions">
        {isAdmin ? (
          <Link
            href={`${base}?privileged=admin`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            管理者権限で編集
          </Link>
        ) : null}
        {canOfferEventMode ? (
          <Link
            href={`${base}?privileged=event`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            イベント運営権限で編集
          </Link>
        ) : null}
      </span>
    </div>
  );
}

export default async function EditVideoPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const requestedMode = normalizePrivilegeMode((await searchParams)?.privileged);
  const guard = await requireSession({
    next: `/dashboard/edit/${encodeURIComponent(id)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  let privilegeMode: PrivilegeMode = "normal";
  if (requestedMode === "admin" && user.role === "admin") {
    privilegeMode = "admin";
  } else if (requestedMode === "event") {
    privilegeMode = "event";
  }

  const db = getDatabase();
  if (!db) notFound();
  const video = (
    await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1)
  )[0];
  if (!video) notFound();

  const editUser = { id: user.id, role: user.role ?? null };
  const sections = await computeAllowedVideoEditSections({
    db,
    user: editUser,
    video,
    privilegeMode,
  });
  const canEditAnySection = hasAnyVideoEditSection(sections);
  const canOfferAdminMode = user.role === "admin" && privilegeMode !== "admin";
  let canOfferEventMode = false;
  if (privilegeMode === "normal" && !canEditAnySection) {
    const eventModeSections = await computeAllowedVideoEditSections({
      db,
      user: editUser,
      video,
      privilegeMode: "event",
    });
    canOfferEventMode = hasAnyVideoEditSection(eventModeSections);
  }
  const canShowPrivilegeSwitchOnly =
    !canEditAnySection && (canOfferAdminMode || canOfferEventMode);

  if (!canEditAnySection && !canShowPrivilegeSwitchOnly) {
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-status-panel fn-status-panel--center fn-status-panel--warn">
          <h1 className="fn-guard-title fn-guard-title--warn">編集権限がありません</h1>
          <p className="fn-status-panel-lead">
            この作品の作者本人、または担当イベントの運営のみが編集できます。
          </p>
          <div className="fn-panel-actions fn-panel-actions--row">
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
      </div>
    );
  }

  const memberRows = await db
    .select({
      x_user_id: videoMembers.x_user_id,
      name: videoMembers.name,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
      can_edit: videoMembers.can_edit,
      is_public_member: videoMembers.is_public_member,
    })
    .from(videoMembers)
    .where(and(
      eq(videoMembers.video_id, video.id),
      eq(videoMembers.is_public_member, 1),
    )!)
    .orderBy(videoMembers.order_index);
  const initialMembers = memberRows.map((member) => ({
    name: member.name,
    x_user_id: member.x_user_id ?? "",
    role: member.role ?? "",
    comment: member.comment ?? "",
    can_edit: member.can_edit,
    is_public_member: member.is_public_member,
  }));

  const creatorX = video.creator_x_user_id;
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
  const softwareLabel = await getVideoSoftwareLabel(db, video.id);
  const iconCandidates = creatorX ? await getXIconCandidates(db, creatorX) : [];
  const channelCandidates = creatorX
    ? await getYoutubeChannelCandidates(db, creatorX)
    : [];

  const currentVideoEvents = await db
    .select({ event_id: videoEventsTable.event_id })
    .from(videoEventsTable)
    .where(eq(videoEventsTable.video_id, video.id));
  const currentEventIds = currentVideoEvents.map((row) => row.event_id);
  if (video.primary_event_id && !currentEventIds.includes(video.primary_event_id)) {
    currentEventIds.push(video.primary_event_id);
  }

  const allEventRows = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.visibility_status, "public"));
  const acceptingEventMap = new Map<
    string,
    { id: string; title: string; parts_json?: string | null }
  >();
  for (const event of allEventRows) {
    if (isAcceptingEntries(event) && event.allow_user_video_event_links === 1) {
      acceptingEventMap.set(event.id, {
        id: event.id,
        title: event.title,
        parts_json: event.parts_json,
      });
    }
  }
  if (currentEventIds.length > 0) {
    const attached = await db
      .select({
        id: eventsTable.id,
        title: eventsTable.title,
        parts_json: eventsTable.parts_json,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, currentEventIds));
    for (const event of attached) acceptingEventMap.set(event.id, event);
  }

  const eventOptionRows = Array.from(acceptingEventMap.values());
  const questionsByEvent = sections.descriptions
    ? await fetchActiveCustomQuestionsForEvents(
        db,
        eventOptionRows.map((event) => event.id),
      )
    : new Map();
  const eventOptions = eventOptionRows.map((event) => ({
    ...event,
    custom_questions: questionsByEvent.get(event.id) ?? [],
  }));
  const customAnswerValues = sections.descriptions
    ? await readCustomAnswerValuesForVideo(db, {
        videoId: video.id,
        eventIds: currentEventIds,
      })
    : null;

  const {
    subjects: videoCollabSubjects,
    tableAvailable: videoCollabTableAvailable,
  } = await loadVideoCollabSubjects(db, video.id);
  const permissionSummary = computeEditPermissionSummary(videoCollabSubjects, {
    viewerDiscordId: user.id,
    ownerDiscordId: video.submitted_by_user_id,
  });
  const privilegedQs = privilegeMode === "normal"
    ? ""
    : `?privileged=${privilegeMode}`;

  const xIdOptions = await db
    .select({ id: xUsersTable.id, x_name: xUsersTable.x_name })
    .from(xUsersTable)
    .where(and(
      eq(xUsersTable.linked_user_id, user.id),
      eq(xUsersTable.approval_status, "approved"),
    )!)
    .orderBy(asc(xUsersTable.x_name));

  const canEditIdentity = sections.identity;
  const canEditBasics = sections.basics;
  const canEditYoutube = sections.youtube;
  const canEditCredits = sections.credits;
  const canEditDescriptions = sections.descriptions;
  const canEditMembers = sections.members;
  const canEditPrimaryEvent = sections.primary_event;

  const submitBlockedReason = !canEditAnySection
    ? canOfferAdminMode
      ? "通常編集モードでは編集できる項目がありません。上部の「管理者権限で編集」から明示的に権限を切り替えてください。"
      : canOfferEventMode
        ? "通常編集モードでは編集できる項目がありません。上部の「イベント運営権限で編集」から明示的に権限を切り替えてください。"
        : undefined
    : undefined;
  const disabledSections = [
    !canEditIdentity ? "submitter" : null,
    !canEditBasics && !canEditYoutube && !canEditCredits ? "video" : null,
    !canEditDescriptions ? "descriptions" : null,
    !canEditMembers ? "members" : null,
  ].filter((value): value is string => Boolean(value));
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
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <p className="fn-eyebrow">EDIT</p>
        <h1 className="fn-page-title fn-page-title--compact">{video.title}</h1>
        <p className="fn-page-meta">
          現在の状態:
          <span className="fn-badge fn-badge-soft">{video.visibility_status}</span>
          {video.youtube_video_id ? (
            <a
              href={youtubeWatchUrl(video.youtube_video_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              <Icon name="external" size={12} aria-hidden />
              YouTube で確認
            </a>
          ) : null}
          <Link
            href={`/${video.youtube_video_id ?? video.id}`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            <Icon name="external" size={12} aria-hidden />
            FlameNode で見る
          </Link>
        </p>
        <PrivilegeModeBanner
          mode={privilegeMode}
          isAdmin={user.role === "admin"}
          canOfferEventMode={canOfferEventMode}
          videoId={id}
        />
      </header>

      {privilegeMode === "admin" && user.role === "admin" ? (
        <AdminVideoTabs
          videoId={video.id}
          youtubeVideoId={video.youtube_video_id}
          active="edit"
        />
      ) : null}

      <VideoForm
        mode="edit"
        videoId={video.id}
        xIdOptions={xIdOptions}
        activeXId={user.active_x_user_id ?? undefined}
        disabledSections={disabledSections}
        disabledFields={disabledFields}
        initial={{
          display_name:
            video.creator_display_name ?? xRow?.x_name ?? user.name ?? undefined,
          creator_x_user_id: video.creator_x_user_id ?? undefined,
          icon_url: video.creator_icon_url ?? undefined,
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
          used_software: softwareLabel ?? undefined,
          custom_question_answers_json: customAnswerValues ?? undefined,
          highlights: video.highlights ?? undefined,
          production_story: video.production_story ?? undefined,
          closing_comment: video.closing_comment ?? undefined,
          is_collab:
            video.collaboration_type === "collab" || initialMembers.length > 0,
          members: initialMembers,
          event_ids: currentEventIds,
          part: video.part ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        eventOptions={eventOptions}
        canEditEvents={canEditPrimaryEvent}
        canChangeSubmitter={privilegeMode === "admin" && user.role === "admin"}
        iconCandidates={iconCandidates}
        channelCandidates={channelCandidates}
        editPrivilegeMode={privilegeMode}
        submitBlockedReason={submitBlockedReason}
      />

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden /> 編集権限はこの作品の作者と
        管理者にのみ付与されます。イベント運営は許可された項目のみ編集可能です。
      </p>

      {canEditIdentity &&
      (video.collaboration_type === "collab" ||
        videoCollabSubjects.length > 0 ||
        !videoCollabTableAvailable) ? (
        <VideoEditPermissionSummary
          videoId={video.id}
          summary={permissionSummary}
          canManage={canEditIdentity}
          tableAvailable={videoCollabTableAvailable}
          privilegedQuery={privilegedQs}
        />
      ) : null}

      <div className="fn-page-footer-actions">
        <Link href="/dashboard" className="fn-btn fn-btn-ghost">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
