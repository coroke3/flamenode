import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  // 旧 videoCollaborators テーブルは廃止 (移行先 = video_members.can_edit)。
  // 互換のため import は維持しない。
  videoEvents as videoEventsTable,
  videoMembers,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { VideoEditPermissionSummary } from "@/components/video/VideoEditPermissionSummary";
import {
  computeEditPermissionSummary,
  loadVideoCollabSubjects,
} from "@/lib/video/collabPerms";
import { requireSession } from "@/lib/auth/guard";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
import {
  disabledFieldKeysFromGeneralFields,
  loadGeneralEditableFieldSet,
  normalModeAlwaysDisabledFieldKeys,
} from "@/lib/video/generalEditPermissions";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  getApprovedXIds,
  getEditableEventIds,
  resolveEventStaffVideoPermissionGrant,
  resolveVideoOwnership,
} from "@/lib/auth/ownership";
import { VideoForm } from "@/components/forms/VideoForm";
import { AdminVideoTabs } from "@/components/admin/AdminVideoTabs";
import { VideoEditPermissionOverview } from "@/components/video/permission/VideoEditPermissionOverview";
import { Icon } from "@/components/ui/Icon";
import { youtubeWatchUrl } from "@/lib/youtube/id";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import { readStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import { loadStagePermissionFormSettingsJsonByEvents } from "@/lib/video/stagePermissionQuestions";
import { buildVideoEditPermissionViewModel } from "@/lib/video/videoEditPermissionView";
import type { VideoViewSectionKey } from "@/lib/video/videoEditPermissionView";
import { hasAnyEditableVideoFormSection } from "@/lib/video/permissionUnlockHint";
import type { VideoEditSectionKey } from "@/lib/auth/videoEditSections";

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

/**
 * モード切替リンク専用。説明文は VideoEditPermissionOverview に集約する。
 */
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
}): React.ReactElement | null {
  const base = `/dashboard/edit/${encodeURIComponent(videoId)}`;
  const showAdmin = isAdmin && mode !== "admin";
  const showEvent = canOfferEventMode && mode !== "event";
  const showNormal = mode !== "normal";
  if (!showAdmin && !showEvent && !showNormal) return null;

  return (
    <div
      className={`fn-privilege-banner fn-privilege-banner--${mode} fn-privilege-banner--switch`}
      aria-label="編集権限モードの切替"
    >
      <span className="fn-privilege-banner-actions">
        {showAdmin ? (
          <Link
            href={`${base}?privileged=admin`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            管理者権限で編集
          </Link>
        ) : null}
        {showEvent ? (
          <Link
            href={`${base}?privileged=event`}
            className="fn-btn fn-btn-ghost fn-btn-sm"
          >
            イベント運営権限で編集
          </Link>
        ) : null}
        {showNormal ? (
          <Link href={base} className="fn-btn fn-btn-ghost fn-btn-sm">
            通常モードへ戻る
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
  const sp = (await searchParams) ?? {};
  const requestedMode = normalizePrivilegeMode(sp.privileged);
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

  const editUser = { id: user.id, role: user.role ?? null };
  const canOfferEventMode = await canUseEventPrivilegeModeForVideo({
    db,
    user: editUser,
    video,
  });

  // 管理者以外が ?privileged=admin を付けても normal にフォールバック。
  // event モードは canUseEventPrivilegeModeForVideo が true のときだけ。
  let privilegeMode: PrivilegeMode = "normal";
  if (requestedMode === "admin" && user.role === "admin") {
    privilegeMode = "admin";
  } else if (requestedMode === "event" && canOfferEventMode) {
    privilegeMode = "event";
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
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(videoMembers.order_index);
  const initialMembers = memberRows.map((m) => ({
    name: m.name,
    x_user_id: m.x_user_id ?? "",
    role: m.role ?? "",
    comment: m.comment ?? "",
    can_edit: m.can_edit,
    is_public_member: m.is_public_member,
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
  // 編集対象作品の主体 X ID に紐づく候補を出す。
  // admin が他者作品を編集する場合も creator/contact 由来の候補が出る。
  const iconCandidates = creatorX ? await getXIconCandidates(db, creatorX) : [];
  const channelCandidates = creatorX
    ? await getYoutubeChannelCandidates(db, creatorX)
    : [];

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
    .where(eq(eventsTable.visibility_status, "public"));
  const acceptingEventMap = new Map<
    string,
    {
      id: string;
      title: string;
      video_form_settings_json?: string | null;
      parts_json?: string | null;
    }
  >();
  for (const ev of allEventRows) {
    // 受付中 + 「一般ユーザーの追加紐付け = 許可」のイベントを候補に出す。
    // 既に紐付いているイベントは下の attached 補完で必ず候補に含まれる。
    if (isAcceptingEntries(ev) && ev.allow_user_video_event_links === 1) {
      acceptingEventMap.set(ev.id, {
        id: ev.id,
        title: ev.title,
        parts_json: ev.parts_json,
      });
    }
  }
  // 現在紐付いているイベントは受付状態を問わず候補に含める
  if (currentEventIds.length > 0) {
    const attached = await db
      .select({
        id: eventsTable.id,
        title: eventsTable.title,
        parts_json: eventsTable.parts_json,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, currentEventIds));
    for (const ev of attached) acceptingEventMap.set(ev.id, ev);
  }
  const formSettingsByEvent = await loadStagePermissionFormSettingsJsonByEvents(
    db,
    Array.from(acceptingEventMap.keys()),
  );
  const eventOptions = Array.from(acceptingEventMap.values()).map((event) => ({
    ...event,
    video_form_settings_json: formSettingsByEvent.get(event.id) ?? null,
  }));
  const stagePermissionInitial = await readStagePermissionCustomAnswers(db, {
    videoId: video.id,
    eventIds: currentEventIds,
  });

  // 作品単位の合作メンバー編集権限。subject ごと 1 行 (can_edit ON/OFF)。
  const { subjects: videoCollabSubjects, tableAvailable: videoCollabTableAvailable } =
    await loadVideoCollabSubjects(db, video.id);
  const permissionSummary = computeEditPermissionSummary(videoCollabSubjects, {
    viewerDiscordId: user.id,
    ownerDiscordId: video.submitted_by_user_id,
  });
  const privilegedQs =
    privilegeMode === "normal" ? "" : `?privileged=${privilegeMode}`;

  // 通常チャプターコメントの投稿は公開動画詳細ページに戻したが、CSV 一括登録だけは
  // 編集権限を持つユーザー向けにこの編集ページから行う。
  // 投稿主体は active X ID なので、ChapterComposer 内部の writeGuard と同じ条件で
  // X 承認状態を計算する。
  const xIdOptions = (await getLinkedXUsersForAuthUser(db, user.id, { approvedOnly: true }))
    .map((row) => ({ id: row.x_user_id, x_name: row.x_name }))
    .sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));

  const generalFields =
    privilegeMode === "normal"
      ? await loadGeneralEditableFieldSet(db, video)
      : undefined;

  const ownership = await resolveVideoOwnership({
    db,
    userId: user.id,
    video,
  });
  const approvedXIds = await getApprovedXIds(db, user.id);
  const editableEventIds = await getEditableEventIds(db, user.id, currentEventIds);
  const isEventStaffForVideo = editableEventIds.length > 0;

  let membershipHint: "none" | "member_no_edit" | "outsider" = "outsider";
  if (ownership.isOwner) {
    membershipHint = "none";
  } else if (approvedXIds.length > 0) {
    const membershipRows = await db
      .select({ can_edit: videoMembers.can_edit })
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, video.id),
          inArray(videoMembers.x_user_id, approvedXIds),
        )!,
      )
      .limit(8);
    if (membershipRows.some((row) => row.can_edit === 0)) {
      membershipHint = "member_no_edit";
    } else if (membershipRows.length === 0) {
      membershipHint = "outsider";
    }
  }

  const [
    canEditIdentity,
    canEditBasics,
    canEditYoutube,
    canEditCredits,
    canEditDescriptions,
    canEditMembers,
    canEditMemberChapters,
    canEditPermissions,
    canEditPrimaryEvent,
    canEditVisibility,
  ] = await Promise.all([
    canEditVideo({ db, user: editUser, video, requiredKey: "video.identity", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.basics", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.youtube_id", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.credits", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.descriptions", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.members", privilegeMode, generalFields }),
    canEditVideo({
      db,
      user: editUser,
      video,
      requiredKey: "video.member_chapters",
      privilegeMode,
      generalFields,
    }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.permissions", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.primary_event", privilegeMode, generalFields }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.status", privilegeMode, generalFields }),
  ]);

  const canOfferAdminMode = user.role === "admin" && privilegeMode !== "admin";
  const eventTitleById = new Map(
    eventOptions.map((event) => [event.id, event.title] as const),
  );
  // eventOptions に無い所属イベント名を補完
  if (currentEventIds.length > 0) {
    for (const eventId of currentEventIds) {
      if (eventTitleById.has(eventId)) continue;
      const missing = acceptingEventMap.get(eventId);
      if (missing) eventTitleById.set(missing.id, missing.title);
    }
  }

  const sectionPermissionKeys: Array<{
    section: VideoViewSectionKey;
    key: VideoEditSectionKey;
  }> = [
    { section: "identity", key: "video.identity" },
    { section: "basics", key: "video.basics" },
    { section: "youtube", key: "video.youtube_id" },
    { section: "credits", key: "video.credits" },
    { section: "descriptions", key: "video.descriptions" },
    { section: "members", key: "video.members" },
    { section: "memberChapters", key: "video.member_chapters" },
    { section: "primaryEvent", key: "video.primary_event" },
    { section: "visibility", key: "video.status" },
    { section: "permissions", key: "video.permissions" },
  ];

  let sectionEventSources:
    | Partial<Record<VideoViewSectionKey, { eventId?: string; eventTitle?: string }>>
    | undefined;
  if (privilegeMode === "event") {
    sectionEventSources = {};
    await Promise.all(
      sectionPermissionKeys.map(async ({ section, key }) => {
        const grant = await resolveEventStaffVideoPermissionGrant({
          db,
          user: editUser,
          video,
          requiredKey: key,
          approvedXUserIds: approvedXIds,
        });
        if (!grant.allowed || !grant.eventId) return;
        sectionEventSources![section] = {
          eventId: grant.eventId,
          eventTitle: eventTitleById.get(grant.eventId),
        };
      }),
    );
  }

  const eventTitleForMode =
    privilegeMode === "event"
      ? (video.primary_event_id && eventTitleById.get(video.primary_event_id)) ||
        Object.values(sectionEventSources ?? {})
          .map((meta) => meta?.eventTitle)
          .find(Boolean) ||
        editableEventIds.map((id) => eventTitleById.get(id)).find(Boolean) ||
        null
      : null;

  const permissionView = buildVideoEditPermissionViewModel({
    privilegeMode,
    ownership,
    canOfferAdminMode,
    canOfferEventMode,
    membershipHint,
    eventId:
      privilegeMode === "event"
        ? video.primary_event_id ?? editableEventIds[0]
        : undefined,
    eventTitle: eventTitleForMode ?? undefined,
    sectionEventSources,
    sections: {
      identity: canEditIdentity,
      basics: canEditBasics,
      youtube: canEditYoutube,
      credits: canEditCredits,
      descriptions: canEditDescriptions,
      members: canEditMembers,
      memberChapters: canEditMembers && canEditMemberChapters,
      primaryEvent: canEditPrimaryEvent,
      visibility: canEditVisibility,
      permissions: canEditPermissions,
    },
  });

  const canEditAnySection = hasAnyEditableVideoFormSection(permissionView);
  const canEditAnyCapability = canEditAnySection || canEditPermissions;

  const hasAnyEditCapability =
    canEditAnyCapability ||
    canOfferAdminMode ||
    canOfferEventMode;

  const resolveNoAccessMessage = (): string => {
    if (!ownership.isOwner && isEventStaffForVideo && !canOfferEventMode) {
      return "この作品に対する運営権限が不足しています。";
    }
    if (ownership.isOwner && privilegeMode === "normal" && !canEditAnyCapability) {
      return "この項目は、現在の一般作品権限では編集できません。";
    }
    return "この作品を編集できません。作品の作者、編集権限を付与された合作メンバー、または権限を持つ運営のみ編集できます。";
  };

  const resolveSwitchOnlyMessage = (): string => {
    if (canOfferAdminMode) {
      return "通常編集モードでは編集できる項目がありません。上部の「管理者権限で編集」から明示的に権限を切り替えてください。";
    }
    if (canOfferEventMode) {
      return "通常編集モードでは編集できる項目がありません。上部の「イベント運営権限で編集」から明示的に権限を切り替えてください。";
    }
    return resolveNoAccessMessage();
  };

  const canShowPrivilegeSwitchOnly =
    !canEditAnySection && (canOfferAdminMode || canOfferEventMode);

  if (!hasAnyEditCapability) {
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-status-panel fn-status-panel--center fn-status-panel--warn">
          <h1 className="fn-guard-title fn-guard-title--warn">編集権限がありません</h1>
          <p className="fn-status-panel-lead">{resolveNoAccessMessage()}</p>
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

  const disabledSections = [
    !canEditIdentity ? "submitter" : null,
    !canEditBasics && !canEditYoutube && !canEditCredits ? "video" : null,
    !canEditDescriptions ? "descriptions" : null,
    !canEditMembers && !canEditMemberChapters ? "members" : null,
  ].filter((v): v is string => Boolean(v));

  const generalDisabledFields =
    generalFields !== undefined
      ? disabledFieldKeysFromGeneralFields(generalFields)
      : [];
  const normalModeIdentityExtras =
    privilegeMode === "normal"
      ? [
          "submitter.profile_text",
          "submitter.youtube_channel_url",
          "submitter.other_social_links",
        ]
      : [];

  const disabledFields = [
    !canEditIdentity ? "submitter.display_name" : null,
    !canEditIdentity ? "submitter.icon_url" : null,
    !canEditIdentity ? "submitter.profile_text" : null,
    !canEditIdentity ? "submitter.youtube_channel_url" : null,
    !canEditIdentity ? "submitter.other_social_links" : null,
    !canEditBasics ? "video.title" : null,
    !canEditBasics ? "video.part" : null,
    !canEditYoutube ? "video.youtube_url" : null,
    !canEditCredits ? "video.music" : null,
    !canEditCredits ? "video.credit" : null,
    !canEditMemberChapters ? "chapters" : null,
    !canEditMembers ? "members.list" : null,
    ...normalModeIdentityExtras,
    ...(privilegeMode === "normal" ? normalModeAlwaysDisabledFieldKeys() : []),
    ...generalDisabledFields,
  ].filter((v): v is string => Boolean(v));

  const defaultProfile = xRow
    ? {
        display_name: xRow.x_name,
        icon_url: xRow.icon_url,
        profile_text: xRow.profile_text,
        youtube_channel_url: xRow.youtube_channel_url,
        other_social_links: xRow.other_social_links,
      }
    : undefined;

  const pageHeader = (
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
        canOfferEventMode={canOfferEventMode && privilegeMode !== "event"}
        videoId={id}
      />
    </header>
  );

  if (canShowPrivilegeSwitchOnly) {
    return (
      <div className="fn-public-container fn-page fn-page--video-edit">
        {pageHeader}
        <VideoEditPermissionOverview
          viewModel={permissionView}
          eventTitleForMode={eventTitleForMode}
        />
        <div className="fn-status-panel fn-status-panel--warn">
          <p className="fn-status-panel-lead">{resolveSwitchOnlyMessage()}</p>
        </div>
        <div className="fn-page-footer-actions">
          <Link href="/dashboard" className="fn-btn fn-btn-ghost">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fn-public-container fn-page fn-page--video-edit">
      {pageHeader}

      {privilegeMode === "admin" && user.role === "admin" ? (
        <AdminVideoTabs
          videoId={video.id}
          youtubeVideoId={video.youtube_video_id}
          active="edit"
        />
      ) : null}

      <VideoEditPermissionOverview
        viewModel={permissionView}
        eventTitleForMode={eventTitleForMode}
      />

      <VideoForm
        mode="edit"
        videoId={video.id}
        xIdOptions={xIdOptions}
        activeXId={user.active_x_user_id ?? undefined}
        disabledSections={disabledSections}
        disabledFields={disabledFields}
        permissionView={permissionView}
        submitBlockedReason={
          !canEditAnySection
            ? permissionView.canOfferEventMode && privilegeMode === "normal"
              ? "イベント運営権限で編集できる項目があります。上部の「イベント運営権限で編集」を選択してください。"
              : permissionView.canOfferAdminMode && privilegeMode === "normal"
                ? "管理者権限で編集できる項目があります。上部の「管理者権限で編集」を選択してください。"
                : "現在の権限では編集できる項目がありません。"
            : undefined
        }
        initial={{
          display_name: video.creator_display_name ?? undefined,
          creator_x_user_id: video.creator_x_user_id ?? undefined,
          icon_url: video.creator_icon_url ?? undefined,
          profile_text: video.creator_profile_text ?? undefined,
          youtube_channel_url: video.creator_youtube_channel_url ?? undefined,
          other_social_links: video.creator_other_social_links ?? undefined,
          title: video.title,
          youtube_url: video.youtube_video_id
            ? youtubeWatchUrl(video.youtube_video_id)
            : undefined,
          music: video.music ?? undefined,
          music_reference_url: video.music_reference_url ?? undefined,
          credit: video.credit ?? undefined,
          intro_comment: video.intro_comment ?? undefined,
          used_software: softwareLabel ?? undefined,
          custom_question_answers_json: stagePermissionInitial ?? undefined,
          highlights: video.highlights ?? undefined,
          production_story: video.production_story ?? undefined,
          closing_comment: video.closing_comment ?? undefined,
          is_collab: video.collaboration_type === "collab" || initialMembers.length > 0,
          members: initialMembers,
          event_ids: currentEventIds,
          part: video.part ?? undefined,
        }}
        defaultProfile={defaultProfile}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        eventOptions={eventOptions}
        canEditEvents={canEditPrimaryEvent}
        canChangeSubmitter={privilegeMode === "admin" && user.role === "admin"}
        iconCandidates={iconCandidates}
        channelCandidates={channelCandidates}
        editPrivilegeMode={privilegeMode}
      />

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden /> 編集権限は作品の作者、編集権限を付与された合作メンバー、
        または許可されたイベント運営に限定されます。
      </p>

      {canEditPermissions &&
      (video.collaboration_type === "collab" ||
        videoCollabSubjects.length > 0 ||
        !videoCollabTableAvailable) ? (
        <VideoEditPermissionSummary
          videoId={video.id}
          summary={permissionSummary}
          canManage={canEditPermissions}
          tableAvailable={videoCollabTableAvailable}
          privilegedQuery={privilegedQs}
        />
      ) : null}

      {/* 通常チャプターコメントの投稿は公開動画詳細ページに戻された。
          メンバーチャプターは VideoMembersField で扱う。 */}

      <div className="fn-page-footer-actions">
        <Link href="/dashboard" className="fn-btn fn-btn-ghost">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
