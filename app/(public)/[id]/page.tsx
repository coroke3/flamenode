import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { buildAccentVars } from "@/lib/theme/accent";
import styles from "./page.module.css";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import {
  canEditVideo,
  getApprovedXIds,
  resolveAdminOrEventVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { withDatabase } from "@/lib/cloudflare";
import {
  videoInteractionsAuth,
  videos as videosTable,
  xUsers,
} from "@/lib/db/schema";
import {
  fetchAuthorizedPrivateVideoChapters,
  fetchEventPlaylistVideos,
  type AuthorizedPrivateVideoChapter,
} from "@/lib/db/videoDetailQueries";
import { fetchVideoRowByIdOrYoutube } from "@/lib/db/videoIdLookup";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { extractYoutubeId, youtubeThumbUrl } from "@/lib/youtube/id";
import { YoutubePlayer } from "@/components/video/YoutubePlayer";
import { VideoViewTracker } from "@/components/video/VideoViewTracker";
import { FixedVideoPlayerFrame } from "@/components/video/FixedVideoPlayerFrame";
import fixedPlayerStyles from "@/components/video/FixedVideoPlayerFrame.module.css";
import { IntroCommentBlock } from "@/components/video/IntroCommentBlock";
import { VideoUtilityDock } from "@/components/video/VideoUtilityDock";
import { InteractionButton } from "@/components/video/InteractionButton";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { MemberSection } from "@/components/video/MemberSection";
import { Icon } from "@/components/ui/Icon";
import { UserAvatar } from "@/components/user/UserAvatar";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, buildPageMetadata, compactText } from "@/lib/seo";
import { formatUnix } from "@/lib/utils/format";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import {
  loadStaticVideoDetail,
  PublicDataUnavailableNotice,
  PublicReflectionPendingNotice,
  shouldPublicPageNotFound,
  shouldPublicPageShowReflection,
  shouldPublicPageShowUnavailable,
  type StaticVideoDetail,
} from "@/lib/publicData/loader";
import { isPublicEntityVisibilityBlocked } from "@/lib/publicData/publicVisibilityManifest";
import {
  logPublicRequestMetrics,
  setPublicRequestRoute,
} from "@/lib/publicData/loader";
import {
  buildPublicVideoViewModelFromStatic,
  filterPublicVideoDetailEvents,
} from "@/lib/publicData/publicVideoDetailViewModel";
import {
  loadPublicXIconMapOptional,
  loadRandomVideoPool,
  loadYoutubeRelatedBlocklist,
} from "@/lib/publicData/staticSharedInputsLoader";
import { RELATED_MIN_LIMIT } from "@/lib/publicData/relatedVideoProjection";
import type { StaticRelatedVideo } from "@/lib/publicData/staticVideoDetailCore";
import { mergeVideoChapterOverlay } from "@/lib/publicData/privateVideoChapterOverlay";
import {
  hasProjectedPublicProfile,
  publicXIconEntriesToMap,
  resolveProjectedIcon,
  type PublicXIconEntry,
} from "@/lib/publicData/publicIconProjection";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ playlist?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const staticLoaded = await loadStaticVideoDetail(id);
  if (staticLoaded.data) {
      const { video } = staticLoaded.data;
      const videoPath = `/${video.youtube_video_id ?? video.id}`;
      const description = compactText(
        video.intro_comment ||
          video.highlights ||
          [
            video.music ? `使用楽曲: ${video.music}` : null,
            video.credit ? `クレジット: ${video.credit}` : null,
          ]
            .filter(Boolean)
            .join(" / "),
      );
      const metadataYoutubeId = extractYoutubeId(video.youtube_video_id);
      return buildPageMetadata({
        title: `${video.title} - ${video.creator_display_name ?? "unknown"}`,
        description,
        path: videoPath,
        image: metadataYoutubeId
          ? youtubeThumbUrl(metadataYoutubeId, "maxresdefault")
          : video.creator_icon_url,
        noIndex: video.visibility_status !== "public",
        ogType: "video.other",
      });
  }
  return { title: id };
}

export default async function VideoDetailPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id: rawId } = await params;
  const { playlist = "" } = (await searchParams) ?? {};

  setPublicRequestRoute(`/${rawId}`);

  const staticProbe = await loadStaticVideoDetail(rawId);
  if (staticProbe.data) {
    const detail = await filterBlockedVideoEvents(staticProbe.data);
    const overlay = await fetchVideoViewerOverlay({
      rawId,
      videoId: detail.video.id,
      playlist,
      playlistEventTitle:
        detail.publicEvents.find((event) => event.id === playlist)
          ?.title ?? null,
    });
    const relatedIconCandidates = [
      ...detail.relatedVideos,
      ...detail.relatedReserve,
      ...detail.relatedRandomReserve,
    ];

    const staticIconXIds = [
      detail.video.creator_x_user_id,
      ...detail.publicMembers.map((member) => member.x_user_id),
      ...relatedIconCandidates.map((video) => video.creator_x_user_id),
    ].filter((xId): xId is string => Boolean(xId));
    const needsIconMap = staticIconXIds.length > 0;

    const iconMapPromise = needsIconMap
      ? loadPublicXIconMapOptional(staticIconXIds)
      : null;

    const blocklist = await loadYoutubeRelatedBlocklist();

    let relatedFallbackPool: StaticRelatedVideo[] = [];
    let relatedSharedStatus = blocklist.status;

    if (blocklist.status !== "unavailable") {
      const embeddedIds = new Set<string>();

      for (const candidate of [
        ...detail.relatedVideos,
        ...detail.relatedReserve,
        ...detail.relatedRandomReserve,
      ]) {
        if (
          candidate.id === detail.video.id ||
          blocklist.value.blockedIds.has(candidate.id)
        ) {
          continue;
        }
        embeddedIds.add(candidate.id);
      }

      if (
        detail.schemaVersion === 1 ||
        embeddedIds.size < RELATED_MIN_LIMIT
      ) {
        const randomPool = await loadRandomVideoPool();
        if (randomPool.status === "unavailable") {
          relatedSharedStatus = "unavailable";
        } else {
          if (randomPool.status === "stale") {
            relatedSharedStatus = "stale";
          }
          relatedFallbackPool = randomPool.value.items;
        }
      }
    }

    const staticIconIdSet = new Set(staticIconXIds);
    const fallbackIconXIds = relatedFallbackPool
      .map((video) => video.creator_x_user_id)
      .filter((xId): xId is string => Boolean(xId));
    const extraFallbackIconXIds = fallbackIconXIds.filter(
      (xId) => !staticIconIdSet.has(xId),
    );
    // 先読み結果を使い、fallback で新規 X ID が増えたときだけ再読込する。
    let iconMapPayload = iconMapPromise ? await iconMapPromise : null;
    if (extraFallbackIconXIds.length > 0) {
      iconMapPayload = await loadPublicXIconMapOptional([
        ...staticIconXIds,
        ...extraFallbackIconXIds,
      ]);
    } else if (!iconMapPayload && fallbackIconXIds.length > 0) {
      iconMapPayload = await loadPublicXIconMapOptional(fallbackIconXIds);
    }

    logPublicRequestMetrics();

    return (
      <StaticVideoDetailView
        detail={detail}
        rawId={rawId}
        playlist={playlist}
        overlay={overlay}
        relatedSharedStatus={relatedSharedStatus}
        relatedBlockedIds={blocklist.value.blockedIds}
        relatedFallbackPool={relatedFallbackPool}
        iconMap={publicXIconEntriesToMap(iconMapPayload)}
      />
    );
  }
  if (shouldPublicPageShowReflection(staticProbe.state)) {
    return <PublicReflectionPendingNotice />;
  }
  if (shouldPublicPageShowUnavailable(staticProbe.state)) {
    return <PublicDataUnavailableNotice />;
  }
  if (shouldPublicPageNotFound(staticProbe.state)) {
    notFound();
  }
  notFound();
}

async function filterBlockedVideoEvents(
  detail: StaticVideoDetail,
): Promise<StaticVideoDetail> {
  const eventIds = new Set([
    ...detail.eventIds,
    ...detail.publicEvents.map((event) => event.id),
  ]);
  if (eventIds.size === 0) return detail;

  const blockedEventIds = new Set<string>();
  await Promise.all(
    [...eventIds].map(async (eventId) => {
      if (
        await isPublicEntityVisibilityBlocked({
          entityType: "event",
          entityId: eventId,
        })
      ) {
        blockedEventIds.add(eventId);
      }
    }),
  );
  return filterPublicVideoDetailEvents(detail, blockedEventIds);
}

type VideoViewerOverlay = {
  viewerUser: Awaited<ReturnType<typeof getCurrentUser>>;
  authUnavailable: boolean;
  likeActive: boolean;
  bookmarkActive: boolean;
  viewerXApproved: boolean;
  viewerCanEditChapters: boolean;
  privateChapters: AuthorizedPrivateVideoChapter[];
  playlistLabel: string;
  playlistItems: {
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
  }[];
};

async function fetchVideoViewerOverlay({
  rawId,
  videoId,
  playlist,
  playlistEventTitle,
}: {
  rawId: string;
  videoId: string;
  playlist: string;
  playlistEventTitle?: string | null;
}): Promise<VideoViewerOverlay> {
  const emptyOverlay: VideoViewerOverlay = {
    viewerUser: null,
    authUnavailable: false,
    likeActive: false,
    bookmarkActive: false,
    viewerXApproved: false,
    viewerCanEditChapters: false,
    privateChapters: [],
    playlistLabel: "再生リスト",
    playlistItems: [],
  };

  let viewerUser: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let authUnavailable = false;
  try {
    viewerUser = await getCurrentUser();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CurrentUserUnavailableError) {
      authUnavailable = true;
    } else {
      throw error;
    }
  }

  const authenticatedViewer = viewerUser;
  const viewerActiveX = authenticatedViewer?.active_x_user_id ?? null;
  const eventPlaylistRequested =
    Boolean(playlist) && playlist !== "lib-like" && playlist !== "lib-bookmark";
  const needsDatabaseOverlay = Boolean(
    authenticatedViewer || eventPlaylistRequested,
  );

  if (!needsDatabaseOverlay) {
    return { ...emptyOverlay, viewerUser, authUnavailable };
  }

  try {
    const overlay = await withDatabase(async (db) => {
      let viewerCanEditChapters = false;
      let approvedXIds: string[] = [];
      let privateChapters: AuthorizedPrivateVideoChapter[] = [];
      if (authenticatedViewer) {
        if (authenticatedViewer.role !== "admin") {
          approvedXIds = await getApprovedXIds(db, authenticatedViewer.id);
        }
        const probe = await fetchVideoRowByIdOrYoutube(db, rawId);
        if (probe) {
          viewerCanEditChapters = await canEditVideo({
            db,
            user: {
              id: authenticatedViewer.id,
              role: authenticatedViewer.role ?? null,
            },
            video: probe,
            requiredKey: "video.chapter_admin",
            privilegeMode: resolveAdminOrEventVideoPrivilegeMode(
              authenticatedViewer.role,
            ),
            approvedXUserIds: approvedXIds,
          });
        }

        if (viewerCanEditChapters || approvedXIds.length > 0) {
          privateChapters = await fetchAuthorizedPrivateVideoChapters(
            db,
            videoId,
            {
              id: authenticatedViewer.id,
              role: authenticatedViewer.role ?? null,
              approvedXIds,
              canEditChapters: viewerCanEditChapters,
            },
          );
        }
      }

      let likeActive = false;
      let bookmarkActive = false;
      let viewerXApproved = false;
      if (authenticatedViewer?.id) {
        const interactions = await db
          .select()
          .from(videoInteractionsAuth)
          .where(
            and(
              eq(videoInteractionsAuth.auth_user_id, authenticatedViewer.id),
              eq(videoInteractionsAuth.video_id, videoId),
            )!,
          );
        likeActive = interactions.some((i) => i.interaction_type === "like");
        bookmarkActive = interactions.some(
          (i) => i.interaction_type === "bookmark",
        );
      }
      if (viewerActiveX) {
        // Keep the existing comment-posting semantics (global approval),
        // while private chapter visibility below remains linked+approved-only.
        const xRow = (
          await db
            .select({ approval_status: xUsers.approval_status })
            .from(xUsers)
            .where(eq(xUsers.id, viewerActiveX))
            .limit(1)
        )[0];
        viewerXApproved = xRow?.approval_status === "approved";
      }

      let playlistLabel = "再生リスト";
      let playlistItems: VideoViewerOverlay["playlistItems"] = [];

      if (playlist) {
        if (playlist === "lib-like" || playlist === "lib-bookmark") {
          if (authenticatedViewer?.id) {
            const kind = playlist === "lib-like" ? "like" : "bookmark";
            // interaction IDを無制限のINへ展開せず、relationから直接JOINする。
            // これによりライブラリ件数に関係なくD1の100 bind上限内に収まる。
            const rows = await db
              .select({
                id: videosTable.id,
                title: videosTable.title,
                youtube_video_id: videosTable.youtube_video_id,
                display_name: videosTable.creator_display_name,
              })
              .from(videoInteractionsAuth)
              .innerJoin(
                videosTable,
                eq(videosTable.id, videoInteractionsAuth.video_id),
              )
              .where(
                and(
                  eq(
                    videoInteractionsAuth.auth_user_id,
                    authenticatedViewer.id,
                  ),
                  eq(videoInteractionsAuth.interaction_type, kind),
                  eq(videosTable.visibility_status, "public"),
                )!,
              )
              .orderBy(desc(videosTable.scheduled_time));
            if (rows.length > 0) {
              playlistLabel =
                kind === "like" ? "いいねした作品" : "セーブした作品";
              playlistItems = rows.map((v) => ({
                id: v.id,
                title: v.title,
                youtube_video_id: v.youtube_video_id,
                display_name: v.display_name,
              }));
            }
          }
        } else {
          const evVideos = await fetchEventPlaylistVideos(db, playlist);
          if (evVideos.length > 1) {
            playlistLabel = `${playlistEventTitle ?? "イベント"} 上映順`;
            playlistItems = evVideos.map((v) => ({
              id: v.id,
              title: v.title,
              youtube_video_id: v.youtube_video_id,
              display_name: v.display_name,
            }));
          }
        }
      }

      return {
        likeActive,
        bookmarkActive,
        viewerXApproved,
        viewerCanEditChapters,
        privateChapters,
        playlistLabel,
        playlistItems,
      };
    });

    if (!overlay) {
      return { ...emptyOverlay, viewerUser, authUnavailable };
    }

    return {
      viewerUser,
      authUnavailable,
      likeActive: overlay.likeActive,
      bookmarkActive: overlay.bookmarkActive,
      viewerXApproved: overlay.viewerXApproved,
      viewerCanEditChapters: overlay.viewerCanEditChapters,
      privateChapters: overlay.privateChapters,
      playlistLabel: overlay.playlistLabel,
      playlistItems: overlay.playlistItems,
    };
  } catch (error) {
    unstable_rethrow(error);
    // 認証済み利用者のoverlay DB障害を「未ログイン」や「未承認X ID」へ変換しない。
    // 匿名のイベント再生リスト取得失敗は認証障害ではないため従来表示を維持する。
    return {
      ...emptyOverlay,
      viewerUser,
      authUnavailable: authUnavailable || Boolean(authenticatedViewer),
    };
  }
}

function StaticVideoDetailView({
  detail,
  rawId,
  playlist = "",
  overlay,
  relatedSharedStatus = "unavailable",
  relatedBlockedIds,
  relatedFallbackPool,
  iconMap,
}: {
  detail: StaticVideoDetail;
  rawId: string;
  playlist?: string;
  overlay?: VideoViewerOverlay | null;
  relatedSharedStatus?: "fresh" | "stale" | "unavailable";
  relatedBlockedIds?: ReadonlySet<string>;
  relatedFallbackPool?: readonly StaticRelatedVideo[];
  iconMap?: Map<string, PublicXIconEntry>;
}): React.ReactElement {
  const vm = buildPublicVideoViewModelFromStatic(detail, {
    relatedUnavailable: relatedSharedStatus === "unavailable",
    relatedBlockedIds,
    relatedFallbackPool,
    iconMap,
  });
  const { video } = vm;
  if (video.visibility_status !== "public") {
    notFound();
  }
  const viewerUser = overlay?.viewerUser ?? null;
  const authUnavailable = overlay?.authUnavailable ?? false;
  const viewerActiveX = viewerUser?.active_x_user_id ?? null;
  const likeActive = overlay?.likeActive ?? false;
  const bookmarkActive = overlay?.bookmarkActive ?? false;
  const viewerXApproved = overlay?.viewerXApproved ?? false;
  const creatorYoutubeChannelUrl = video.creator_youtube_channel_url ?? null;
  const playlistLabel = overlay?.playlistLabel ?? "再生リスト";
  const playlistItems = overlay?.playlistItems ?? [];
  const creatorId = video.creator_x_user_id ?? "anonymous";
  const creatorIcon = video.creator_icon_url ?? null;
  const creatorName =
    video.creator_display_name?.trim() || "作者未設定";
  const creatorHref =
    creatorId !== "anonymous" &&
    ((video.creator_has_public_profile ?? false) ||
      hasProjectedPublicProfile({ xUserId: creatorId, iconMap }))
      ? `/user/${creatorId}`
      : null;
  const youtubeId = video.youtube_video_id
    ? extractYoutubeId(video.youtube_video_id)
    : null;
  const primaryEvent = vm.primaryEvent;
  const primaryEventStatus = primaryEvent ? computeEventStatus(primaryEvent) : null;
  const accentVar = primaryEvent?.accent_color
    ? buildAccentVars(primaryEvent.accent_color, "dark")
    : undefined;
  const videoJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: compactText(
      video.intro_comment ||
        video.highlights ||
        video.production_story ||
        video.closing_comment ||
        (video.music ? `使用楽曲: ${video.music}` : null),
    ),
    url: absoluteUrl(`/${video.youtube_video_id ?? video.id}`),
    thumbnailUrl: youtubeId
      ? [absoluteUrl(youtubeThumbUrl(youtubeId, "maxresdefault"))]
      : undefined,
    uploadDate: video.scheduled_time
      ? new Date(video.scheduled_time * 1000).toISOString()
      : undefined,
    embedUrl: youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : undefined,
    contentUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined,
    author: {
      "@type": "Person",
      name: creatorName,
      url: creatorHref ? absoluteUrl(creatorHref) : undefined,
    },
  };

  const authorBlock = (
    <span className="fn-vd-author">
      <UserAvatar
        iconUrl={creatorIcon}
        label={creatorName}
        size={40}
        useIconFallback
        className={styles.authorIcon}
        imageClassName={styles.authorIcon}
        fallbackClassName={styles.authorIconFb}
      />
      <span>
        <span className={styles.authorName}>{creatorName}</span>
        <span className={styles.authorMeta}>
          {creatorId !== "anonymous" ? <span>@{creatorId}</span> : null}
          {video.scheduled_time ? (
            <span>公開 {formatUnix(video.scheduled_time, { dateOnly: true })}</span>
          ) : null}
        </span>
      </span>
    </span>
  );

  const authorIconLinks: React.ReactNode[] = [];
  if (creatorHref) {
    authorIconLinks.push(
      <Link
        key="flamenode"
        href={creatorHref}
        className="fn-icon-btn"
        aria-label="FlameNode のプロフィールを開く"
        title="FlameNode のプロフィール"
      >
        <Icon name="user" size={13} aria-hidden />
      </Link>,
    );
  }
  if (creatorId && creatorId !== "anonymous") {
    authorIconLinks.push(
      <a
        key="x"
        href={`https://x.com/${creatorId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fn-icon-btn"
        aria-label={`X (@${creatorId}) を開く`}
        title={`X (@${creatorId})`}
      >
        <Icon name="x" size={13} aria-hidden />
      </a>,
    );
  }
  if (creatorYoutubeChannelUrl) {
    authorIconLinks.push(
      <a
        key="youtube"
        href={creatorYoutubeChannelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="fn-icon-btn"
        aria-label="YouTube チャンネルを開く"
        title="YouTube チャンネル"
      >
        <Icon name="youtube" size={13} aria-hidden />
      </a>,
    );
  }
  const authorLinkGroup =
    authorIconLinks.length > 0 ? (
      <div className={styles.authorLinkGroup} aria-label="投稿者へのリンク">
        {authorIconLinks}
      </div>
    ) : null;
  const currentPath = `/${rawId}`;
  const viewerNeedsTermsAcceptance = viewerUser
    ? viewerUser.is_tos_accepted !== 1 || viewerUser.terms_reaccept_required === 1
    : false;
  const canInteract = !!(
    viewerUser?.id &&
    !viewerNeedsTermsAcceptance
  );

  const loginHref = `/entry?next=${encodeURIComponent(currentPath)}`;
  const rulesHref = `/rules?next=${encodeURIComponent(currentPath)}`;
  const onboardingHref = `/onboarding?next=${encodeURIComponent(currentPath)}`;
  const settingsHref =
    `/dashboard/settings?next=${encodeURIComponent(currentPath)}`;

  const chapterEntries = mergeVideoChapterOverlay(
    vm.publicChapters.map((chapter) => ({
      id: chapter.id,
      chapter_time: chapter.chapter_time,
      chapter_label: chapter.chapter_label,
      visibility: "public" as const,
      note: chapter.note,
      author_name: chapter.author_name,
      author_icon: chapter.author_icon,
    })),
    overlay?.privateChapters ?? [],
  ).map((chapter) => ({
    ...chapter,
    marker_kind: "comment" as const,
  }));

  return (
    <div
      className={`fn-vd fn-public-container fn-page ${styles.page}`}
      style={accentVar}
    >
      <JsonLd data={videoJsonLd} />
      <div className={styles.layout}>
        <article className={styles.main}>
          <div className={styles.heroLayout}>
            <FixedVideoPlayerFrame
              className={`${styles.playerPane} ${fixedPlayerStyles.root ?? ""}`.trim()}
            >
              {youtubeId ? (
                <>
                  <YoutubePlayer youtubeId={youtubeId} title={video.title} />
                  <VideoViewTracker
                    videoId={video.id}
                    youtubeVideoId={youtubeId}
                    primaryEventId={primaryEvent?.id ?? null}
                  />
                </>
              ) : (
                <div
                  className="fn-empty"
                  style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}
                >
                  <p>YouTube 動画 ID が登録されていません。</p>
                </div>
              )}
            </FixedVideoPlayerFrame>
            <div className={styles.infoPane}>
              <h1 className={styles.title}>{video.title}</h1>
              <div className={styles.author}>
                {creatorHref ? <Link href={creatorHref}>{authorBlock}</Link> : authorBlock}
                {authorLinkGroup}
                <div className={styles.authorActions}>
                  <InteractionButton
                    videoId={video.id}
                    kind="like"
                    initialActive={likeActive}
                    count={vm.appLikeCount}
                    canInteract={canInteract}
                  />
                  <InteractionButton
                    videoId={video.id}
                    kind="bookmark"
                    initialActive={bookmarkActive}
                    canInteract={canInteract}
                  />
                  {!canInteract ? (
                    <span className={styles.interactionHint}>
                      {authUnavailable ? (
                        <>
                          ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。
                        </>
                      ) : !viewerUser?.id ? (
                        <>
                          ログインするといいね、セーブができます。
                          <Link
                            href={loginHref}
                            className={styles.interactionHintLink}
                          >
                            ログイン
                          </Link>
                        </>
                      ) : viewerNeedsTermsAcceptance ? (
                        <>
                          利用規約に同意するといいね、セーブができます。
                          <Link
                            href={rulesHref}
                            className={styles.interactionHintLink}
                          >
                            利用規約へ
                          </Link>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>

              {primaryEvent ? (
                <div
                  className={styles.eventBox}
                  style={
                    primaryEvent.accent_color
                      ? buildAccentVars(primaryEvent.accent_color, "dark")
                      : undefined
                  }
                >
                  <span className={styles.eventBoxLabel}>イベント</span>
                  {primaryEvent.icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={primaryEvent.icon_url}
                      alt=""
                      className={styles.eventBoxIcon}
                    />
                  ) : null}
                  <Link href={`/event/${primaryEvent.id}`} className={styles.eventBoxTitle}>
                    {primaryEvent.title}
                  </Link>
                  {primaryEventStatus ? (
                    <span
                      className={`fn-badge ${eventStatusBadgeClass(primaryEventStatus)}`}
                    >
                      {eventStatusLabel(primaryEventStatus)}
                    </span>
                  ) : null}
                  {isAcceptingEntries(primaryEvent) ? (
                    <span className="fn-badge fn-badge-soft">受付中</span>
                  ) : null}
                </div>
              ) : null}

              {vm.publicEvents.length > 1 ? (
                <div className="fn-vd-event-tags" aria-label="その他の所属イベント">
                  <span className="fn-vd-event-tags-label">他の所属</span>
                  {vm.publicEvents
                    .filter((event) => !primaryEvent || event.id !== primaryEvent.id)
                    .map((event) => (
                      <Link
                        key={event.id}
                        href={`/event/${event.id}`}
                        className="fn-badge fn-badge-soft"
                      >
                        {event.title}
                      </Link>
                    ))}
                </div>
              ) : null}

              <div className={styles.metaSection}>
                {video.music ? (
                  <InlineMetaItem title="楽曲">
                    {video.music_reference_url ? (
                      <a
                        href={video.music_reference_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="fn-vd-meta-link"
                      >
                        <span>
                          {video.music}
                          {video.credit ? ` / ${video.credit}` : ""}
                        </span>
                        <Icon name="external" size={12} aria-hidden />
                      </a>
                    ) : (
                      <>
                        {video.music}
                        {video.credit ? ` / ${video.credit}` : ""}
                      </>
                    )}
                  </InlineMetaItem>
                ) : null}
                {video.intro_comment ? (
                  <InlineMetaItem title="紹介コメント">
                    <IntroCommentBlock text={video.intro_comment} />
                  </InlineMetaItem>
                ) : null}
                {vm.softwareLabel ? (
                  <InlineMetaItem title="使用ソフト">{vm.softwareLabel}</InlineMetaItem>
                ) : null}
                {video.highlights || video.production_story || video.closing_comment ? (
                  <details className={styles.detailComments}>
                    <summary>詳細コメント</summary>
                    <div className={styles.detailCommentsBody}>
                      {video.highlights ? (
                        <section>
                          <h4 className={styles.inlineMetaTitle}>みどころ</h4>
                          <p style={{ margin: "4px 0 0", lineHeight: 1.7 }}>
                            {video.highlights}
                          </p>
                        </section>
                      ) : null}
                      {video.production_story ? (
                        <section>
                          <h4 className={styles.inlineMetaTitle}>制作エピソード</h4>
                          <p className="fn-vd-meta-body">{video.production_story}</p>
                        </section>
                      ) : null}
                      {video.closing_comment ? (
                        <section>
                          <h4 className={styles.inlineMetaTitle}>あとがき</h4>
                          <p style={{ margin: "4px 0 0", lineHeight: 1.7 }}>
                            {video.closing_comment}
                          </p>
                        </section>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>

              {vm.publicMembers.length > 0 ? (
                <section className={`${styles.section} ${styles.membersBlock}`}>
                  <h2 className={styles.sectionTitle}>
                    参加メンバー ({vm.publicMembers.length})
                  </h2>

                  <MemberSection
                    members={vm.publicMembers.map((member) => ({
                      id: member.id,
                      x_user_id: member.x_user_id,
                      name: member.display_name,
                      role: member.role_label,
                      comment: member.comment ?? null,
                      x_name: member.x_name ?? null,
                      icon_url: resolveProjectedIcon({
                        xUserId: member.x_user_id,
                        iconMap,
                        legacyIconUrl: member.icon_url ?? null,
                      }),
                      has_public_profile:
                        (member.has_public_profile ?? false) ||
                        hasProjectedPublicProfile({
                          xUserId: member.x_user_id,
                          iconMap,
                        }),
                    }))}
                    memberChapters={vm.memberChapters.map((chapter) => ({
                      id: chapter.id,
                      chapter_time: chapter.chapter_time,
                      chapter_label: chapter.chapter_label,
                      note: chapter.note,
                      video_member_id: chapter.video_member_id,
                    }))}
                  />
                </section>
              ) : null}
            </div>
          </div>
        </article>

        <aside className={styles.sideRail} aria-label="動画補助情報">
          <VideoUtilityDock
            videoId={video.id}
            currentId={rawId}
            playlistId={playlist || undefined}
            playlistLabel={playlistLabel}
            playlistItems={playlistItems}
            chapters={chapterEntries}
            isLoggedIn={Boolean(viewerUser?.id)}
            authUnavailable={authUnavailable}
            canPost={viewerXApproved}
            loginHref={loginHref}
            settingsHref={settingsHref}
            activeXId={viewerActiveX}
          />

          <section
            className={styles.relatedRail}
            aria-labelledby="related-videos-title"
          >
            <h3 id="related-videos-title" className={styles.relatedHeading}>
              関連動画
            </h3>

            <RelatedList
              videos={vm.relatedVideos}
              firstCount={18}
              unavailable={relatedSharedStatus === "unavailable"}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

function RelatedList({
  videos,
  firstCount,
  unavailable,
}: {
  videos: VideoCardData[];
  firstCount: number;
  unavailable: boolean;
}): React.ReactElement {
  return (
    <div className={styles.relatedList}>
      {unavailable ? (
        <p className="fn-empty-message" role="status">
          関連動画用の共有データを一時的に利用できません。時間をおいて再読み込みしてください。
        </p>
      ) : videos.length === 0 ? (
        <p className="fn-empty-message">
          関連動画はまだありません。
        </p>
      ) : (
        <>
          {videos.slice(0, firstCount).map((v) => (
            <VideoCard key={`${v.id}-related-${firstCount}`} video={v} size="list" />
          ))}
          {videos.length > firstCount ? (
            <details className={styles.relatedMore}>
              <summary>さらに表示</summary>
              <div className={styles.relatedList}>
                {videos.slice(firstCount, 30).map((v) => (
                  <VideoCard
                    key={`${v.id}-related-more-${firstCount}`}
                    video={v}
                    size="list"
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function InlineMetaItem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.inlineMetaItem}>
      <h3 className={styles.inlineMetaTitle}>{title}</h3>
      <div className={styles.inlineMetaBody}>{children}</div>
    </div>
  );
}
