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
import { canEditVideo } from "@/lib/auth/ownership";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { youtubeWatchUrl } from "@/lib/youtube/id";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { getXIconCandidates } from "@/lib/db/xIconResolution";

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
 * 編集ページの上部に出す「現在の権限モード」バナー + 切替リンク。
 * 通常モードでは目立たないが、admin/event モード時には強めの色味で警告する。
 * モード切替は ?privileged= の URL 書き換えだけで完結する (サーバー側で再検証)。
 */
function PrivilegeModeBanner({
  mode,
  isAdmin,
  canOfferEventMode,
  videoId,
}: {
  mode: PrivilegeMode;
  isAdmin: boolean;
  /** event モードで何らかの section が編集可能になる場合のみ true。 */
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
  // normal: 切替ボタンを表示する (admin / event editor のみ)。
  return (
    <div role="status" className="fn-privilege-banner fn-privilege-banner--normal">
      <Icon name="info" size={11} aria-hidden /> 通常編集モード (作品オーナー / 合作メンバー の権限のみ)
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
  const sp = (await searchParams) ?? {};
  const requestedMode = normalizePrivilegeMode(sp.privileged);
  const guard = await requireSession({
    next: `/dashboard/edit/${encodeURIComponent(id)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  // 管理者/イベント編集者でないユーザーが ?privileged=admin を付けても normal にフォールバック。
  // 「URL を弄れば全部編集できる」抜け穴を作らないため。canEditVideo 側でも再検証される。
  let privilegeMode: PrivilegeMode = "normal";
  if (requestedMode === "admin" && user.role === "admin") {
    privilegeMode = "admin";
  } else if (requestedMode === "event") {
    // event モードの利用可否は canEditVideo に委ねるが、UI上は許可しておく。
    privilegeMode = "event";
  }

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
        video_form_settings_json: ev.video_form_settings_json,
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
        video_form_settings_json: eventsTable.video_form_settings_json,
        parts_json: eventsTable.parts_json,
      })
      .from(eventsTable)
      .where(inArray(eventsTable.id, currentEventIds));
    for (const ev of attached) acceptingEventMap.set(ev.id, ev);
  }
  const eventOptions = Array.from(acceptingEventMap.values());

  // 作品単位の合作メンバー編集権限。subject ごと 1 行 (can_edit ON/OFF)。
  const { subjects: videoCollabSubjects, tableAvailable: videoCollabTableAvailable } =
    await loadVideoCollabSubjects(db, video.id);
  const permissionSummary = computeEditPermissionSummary(videoCollabSubjects, {
    viewerDiscordId: user.id,
    ownerDiscordId: video.submitted_by_discord_user_id,
  });
  const privilegedQs =
    privilegeMode === "normal" ? "" : `?privileged=${privilegeMode}`;

  // 通常チャプターコメントの投稿は公開動画詳細ページに戻したが、CSV 一括登録だけは
  // 編集権限を持つユーザー向けにこの編集ページから行う。
  // 投稿主体は active X ID なので、ChapterComposer 内部の writeGuard と同じ条件で
  // X 承認状態を計算する。
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
    canEditVideo({ db, user: editUser, video, requiredKey: "video.identity", privilegeMode }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.basics", privilegeMode }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.youtube_id", privilegeMode }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.credits", privilegeMode }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.descriptions", privilegeMode }),
    canEditVideo({ db, user: editUser, video, requiredKey: "video.members", privilegeMode }),
  ]);
  const canEditAnySection =
    canEditIdentity ||
    canEditBasics ||
    canEditYoutube ||
    canEditCredits ||
    canEditDescriptions ||
    canEditMembers;

  // モード切替バナーで「管理者権限で編集」「イベント運営権限で編集」を出すかの判定。
  //
  // - canOfferAdminMode: admin role を持っていて、まだ admin モードに入っていない場合。
  //   admin モード時には別の切替先 (event / normal) を出すため除外。
  // - canOfferEventMode: privilegeMode==="normal" で canEditAnySection===false の場合だけ、
  //   event モード試算をして 1 つでも編集可能セクションがあれば true。
  //   admin モード中 (canEditAnySection===true) は試算しないが、admin role でない
  //   ユーザーが ?privileged=event を提示できるよう、一覧化された
  //   event モードでの section 結果を保持する。
  const canOfferAdminMode =
    user.role === "admin" && privilegeMode !== "admin";

  let canOfferEventMode = false;
  if (privilegeMode === "normal" && !canEditAnySection) {
    const eventProbe = await Promise.all([
      canEditVideo({ db, user: editUser, video, requiredKey: "video.identity", privilegeMode: "event" }),
      canEditVideo({ db, user: editUser, video, requiredKey: "video.basics", privilegeMode: "event" }),
      canEditVideo({ db, user: editUser, video, requiredKey: "video.youtube_id", privilegeMode: "event" }),
      canEditVideo({ db, user: editUser, video, requiredKey: "video.credits", privilegeMode: "event" }),
      canEditVideo({ db, user: editUser, video, requiredKey: "video.descriptions", privilegeMode: "event" }),
      canEditVideo({ db, user: editUser, video, requiredKey: "video.members", privilegeMode: "event" }),
    ]);
    canOfferEventMode = eventProbe.some((v) => v === true);
  }

  const canShowPrivilegeSwitchOnly =
    !canEditAnySection && (canOfferAdminMode || canOfferEventMode);

  if (!canEditAnySection && !canShowPrivilegeSwitchOnly) {
    return (
      <main className="fn-public-container fn-page fn-guard-shell">
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
      </main>
    );
  }

  // canEditAnySection===false でも、モード切替で編集可能になる可能性があれば
  // フォーム自体は表示し、保存ボタンを submitBlockedReason で塞ぐ。
  // CLAUDE.md 方針:
  //   - 自動的に admin モードに昇格しない (URL 明示が必要)
  //   - 全 section が disabled になるだけで権限ロジックは canEditVideo 任せ
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

      <VideoForm
        mode="edit"
        videoId={video.id}
        xIdOptions={xIdOptions}
        activeXId={user.active_x_user_id ?? undefined}
        disabledSections={disabledSections}
        disabledFields={disabledFields}
        initial={{
          // 表示名: 既存 video.creator_display_name を優先、空ならその X ID の x_name にフォールバック。
          // 紹介文 / YouTube / SNS は videos には保存されておらず x_users 側 (xRow) のみが正本。
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
          stage_permission: video.stage_permission ?? undefined,
          highlights: video.highlights ?? undefined,
          production_story: video.production_story ?? undefined,
          closing_comment: video.closing_comment ?? undefined,
          is_collab: video.collaboration_type === "collab" || initialMembers.length > 0,
          members: initialMembers,
          event_ids: currentEventIds,
          part: video.part ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        eventOptions={eventOptions}
        canEditEvents={canEditIdentity}
        canChangeSubmitter={privilegeMode === "admin" && user.role === "admin"}
        iconCandidates={iconCandidates}
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

      {/* 通常チャプターコメントの投稿は公開動画詳細ページに戻された。
          メンバーチャプターは VideoMembersField で扱う (将来の Phase 5)。 */}

      <div className="fn-page-footer-actions">
        <Link href="/dashboard" className="fn-btn fn-btn-ghost">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
