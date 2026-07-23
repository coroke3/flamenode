import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { buildAccentVars } from "@/lib/theme/accent";
import styles from "./page.module.css";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  getApprovedXIds,
  canEditVideo,
  resolveAdminOrEventVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { withDatabase } from "@/lib/cloudflare";
import {
  videoInteractions,
  videos as videosTable,
  xUsers,
} from "@/lib/db/schema";
import {
  fetchEventPlaylistVideos,
  fetchRelatedVideos,
  fetchVideoDetail,
} from "@/lib/db/videoDetailQueries";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { extractYoutubeId, youtubeThumbUrl } from "@/lib/youtube/id";
import { YoutubePlayer } from "@/components/video/YoutubePlayer";
import { ChapterTabs } from "@/components/video/ChapterTabs";
import { ChapterComposer } from "@/components/video/ChapterComposer";
import { IntroCommentBlock } from "@/components/video/IntroCommentBlock";
import { PlaylistRail } from "@/components/video/PlaylistRail";
import { InteractionButton } from "@/components/video/InteractionButton";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { MemberSection } from "@/components/video/MemberSection";
import { Icon } from "@/components/ui/Icon";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, buildPageMetadata, compactText } from "@/lib/seo";
import { formatUnix } from "@/lib/utils/format";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { loadStaticVideoDetail } from "@/lib/publicData/loader";
import { canFallbackToDatabase } from "@/lib/publicData/loader";
import type { StaticVideoDetail } from "@/lib/publicData/loader";
import { buildPublicVideoViewModelFromStatic } from "@/lib/publicData/publicVideoDetailViewModel";

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
  const detail = await withDatabase(async (db) => {
    return fetchVideoDetail(db, id);
  });
  if (!detail) return { title: id };
  const videoPath = `/${detail.video.youtube_video_id ?? detail.video.id}`;
  const description = compactText(
    detail.video.intro_comment ||
      detail.video.highlights ||
      [
        detail.video.music ? `使用楽曲: ${detail.video.music}` : null,
        detail.video.credit ? `クレジット: ${detail.video.credit}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
  );
  const metadataYoutubeId = extractYoutubeId(detail.video.youtube_video_id);
  return buildPageMetadata({
    title: `${detail.video.title} - ${detail.video.creator_display_name}`,
    description,
    path: videoPath,
    image: metadataYoutubeId
      ? youtubeThumbUrl(metadataYoutubeId, "maxresdefault")
      : detail.video.creator_icon_url,
    noIndex: detail.video.visibility_status !== "public",
    ogType: "video.other",
  });
}

export default async function VideoDetailPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id: rawId } = await params;
  const { playlist = "" } = (await searchParams) ?? {};

  const staticProbe = await loadStaticVideoDetail(rawId);
  if (staticProbe.data) {
    const overlay = await fetchVideoViewerOverlay({
      rawId,
      videoId: staticProbe.data.video.id,
      playlist,
      creatorXUserId: staticProbe.data.video.creator_x_user_id ?? null,
      playlistEventTitle:
        staticProbe.data.publicEvents.find((event) => event.id === playlist)
          ?.title ?? null,
    });
    return (
      <StaticVideoDetailView
        detail={staticProbe.data}
        rawId={rawId}
        playlist={playlist}
        overlay={overlay}
      />
    );
  }
  if (!canFallbackToDatabase(staticProbe.strategy)) {
    notFound();
  }

  const viewerUser = await getCurrentUser();
  const viewerActiveX = viewerUser?.active_x_user_id ?? null;

  const bundle = await withDatabase(async (db) => {
    const viewerApprovedXIds = viewerUser
      ? await getApprovedXIds(db, viewerUser.id)
      : [];

    let viewerCanEditChapters = false;
    if (viewerUser) {
      const probe = (
        await db
          .select()
          .from(videosTable)
          .where(
            rawId.length === 11
              ? eq(videosTable.youtube_video_id, rawId)
              : eq(videosTable.id, rawId),
          )
          .limit(1)
      )[0];
      if (probe) {
        viewerCanEditChapters = await canEditVideo({
          db,
          user: { id: viewerUser.id, role: viewerUser.role ?? null },
          video: probe,
          requiredKey: "video.chapter_admin",
          privilegeMode: resolveAdminOrEventVideoPrivilegeMode(viewerUser.role),
        });
      }
    }

    const detail = await fetchVideoDetail(db, rawId, {
      id: viewerUser?.id ?? null,
      role: viewerUser?.role ?? null,
      approvedXIds: viewerApprovedXIds,
      canEditChapters: viewerCanEditChapters,
    });
    if (!detail) return null;

    const softwareLabel = await getVideoSoftwareLabel(db, detail.video.id);
    const related = (await fetchRelatedVideos(
      db,
      {
        id: detail.video.id,
        creator_x_user_id: detail.video.creator_x_user_id,
        primary_event_id: detail.video.primary_event_id,
        scheduled_time: detail.video.scheduled_time,
        eventIds: detail.events.map((event) => event.id),
      },
      30,
    )) as VideoCardData[];

    let likeActive = false;
    let bookmarkActive = false;
    let viewerXApproved = false;
    if (viewerActiveX) {
      const interactions = await db
        .select()
        .from(videoInteractions)
        .where(
          and(
            eq(videoInteractions.x_user_id, viewerActiveX),
            eq(videoInteractions.video_id, detail.video.id),
          )!,
        );
      likeActive = interactions.some((i) => i.interaction_type === "like");
      bookmarkActive = interactions.some(
        (i) => i.interaction_type === "bookmark",
      );

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
    let playlistItems: {
      id: string;
      title: string;
      youtube_video_id: string | null;
      display_name: string;
    }[] = [];

    if (playlist) {
      if (playlist === "lib-like" || playlist === "lib-bookmark") {
        if (viewerActiveX) {
          const kind = playlist === "lib-like" ? "like" : "bookmark";
          const myInteractions = await db
            .select({ video_id: videoInteractions.video_id })
            .from(videoInteractions)
            .where(
              and(
                eq(videoInteractions.x_user_id, viewerActiveX),
                eq(videoInteractions.interaction_type, kind),
              )!,
            );
          const ids = myInteractions.map((r) => r.video_id);
          if (ids.length > 0) {
            const rows = await db
              .select({
                id: videosTable.id,
                title: videosTable.title,
                youtube_video_id: videosTable.youtube_video_id,
                display_name: videosTable.creator_display_name,
              })
              .from(videosTable)
              .where(
                and(
                  inArray(videosTable.id, ids),
                  eq(videosTable.visibility_status, "public"),
                )!,
              )
              .orderBy(desc(videosTable.scheduled_time));
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
          const eventTitle =
            detail.events.find((e) => e.id === playlist)?.title ??
            detail.events.find((e) => e.id === detail.video.primary_event_id)
              ?.title ??
            "イベント";
          playlistLabel = `${eventTitle} 上映順`;
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
      detail,
      related,
      likeActive,
      bookmarkActive,
      viewerXApproved,
      softwareLabel,
      playlistLabel,
      playlistItems,
    };
  });

  if (!bundle) notFound();
  const {
    detail: { video, creator, events, members, chapters, memberChapters },
    related,
    likeActive,
    bookmarkActive,
    viewerXApproved,
    softwareLabel,
    playlistLabel,
    playlistItems,
  } = bundle;

  const creatorIcon = video.creator_icon_url ?? null;
  const creatorId = creator?.id ?? video.creator_x_user_id ?? "anonymous";
  const creatorName =
    video.creator_display_name?.trim() ||
    (creatorId !== "anonymous" ? creatorId : "作者未設定");
  const creatorHref =
    creator?.id && creator.id !== "anonymous" ? `/user/${creator.id}` : null;
  const youtubeId = video.youtube_video_id
    ? extractYoutubeId(video.youtube_video_id)
    : null;
  const seoDescription = compactText(
    video.intro_comment ||
      video.highlights ||
      video.production_story ||
      video.closing_comment ||
      (video.music ? `使用楽曲: ${video.music}` : null),
  );
  const videoJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: seoDescription,
    url: absoluteUrl(`/${video.youtube_video_id ?? video.id}`),
    thumbnailUrl: youtubeId
      ? [absoluteUrl(youtubeThumbUrl(youtubeId, "maxresdefault"))]
      : undefined,
    uploadDate: new Date(
      (video.scheduled_time ?? video.created_at) * 1000,
    ).toISOString(),
    embedUrl: youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : undefined,
    contentUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined,
    author: {
      "@type": "Person",
      name: creatorName,
      url:
        creatorId && creatorId !== "anonymous"
          ? absoluteUrl(`/user/${creatorId}`)
          : undefined,
    },
  };

  const primaryEvent =
    events.find((e) => e.id === video.primary_event_id) ?? events[0] ?? null;
  const primaryEventStatus = primaryEvent ? computeEventStatus(primaryEvent) : null;
  const accentVar = primaryEvent?.accent_color
    ? buildAccentVars(primaryEvent.accent_color, "dark")
    : undefined;

  const authorBlock = (
    <span className="fn-vd-author">
      {creatorIcon ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={creatorIcon} alt="" className={styles.authorIcon} />
      ) : (
        <span className={styles.authorIconFb}>
          <Icon name="user" size={18} aria-hidden />
        </span>
      )}
      <span>
        <span className={styles.authorName}>{creatorName}</span>
        <span className={styles.authorMeta}>
          {creatorId && creatorId !== "anonymous" ? (
            <span>@{creatorId}</span>
          ) : null}
          {video.scheduled_time ? (
            <span>
              公開 {formatUnix(video.scheduled_time, { dateOnly: true })}
            </span>
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
  if (creator?.youtube_channel_url) {
    authorIconLinks.push(
      <a
        key="youtube"
        href={creator.youtube_channel_url}
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

  return (
    <div
      className={`fn-vd fn-public-container fn-page ${styles.page}`}
      style={accentVar}
    >
      <JsonLd data={videoJsonLd} />
      <div className={styles.layout}>
        <article className={styles.main}>
          <div className={styles.heroLayout}>
            <div className={styles.playerPane}>
              {youtubeId ? (
                <YoutubePlayer youtubeId={youtubeId} title={video.title} />
              ) : (
                <div
                  className="fn-empty"
                  style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}
                >
                  <p>YouTube 動画 ID が登録されていません。</p>
                </div>
              )}
            </div>

            <div className={styles.infoPane}>
              <h1 className={styles.title}>{video.title}</h1>

          <div className={styles.author}>
            {creatorHref ? <Link href={creatorHref}>{authorBlock}</Link> : authorBlock}
            {authorLinkGroup}
            <div className={styles.authorActions}>
              {(() => {
                const currentPath = `/${rawId}`;
                const canInteract = !!(viewerUser?.id && viewerActiveX && viewerXApproved);
                return (
                  <>
                    <InteractionButton
                      videoId={video.id}
                      kind="like"
                      initialActive={likeActive}
                      count={video.app_like_count ?? 0}
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
                        {!viewerUser?.id ? (
                          <>
                            ログインするといいね、セーブができます。
                            <Link href={`/entry?next=${encodeURIComponent(currentPath)}`} className={styles.interactionHintLink}>
                              ログイン
                            </Link>
                          </>
                        ) : !viewerActiveX ? (
                          <>
                            X IDを選択するといいね、セーブができます。
                            <Link href={`/dashboard/settings?next=${encodeURIComponent(currentPath)}`} className={styles.interactionHintLink}>
                              X ID設定へ
                            </Link>
                          </>
                        ) : (
                          <>
                            承認済みX IDが必要です。
                            <Link href={`/dashboard/settings?next=${encodeURIComponent(currentPath)}`} className={styles.interactionHintLink}>
                              X ID設定へ
                            </Link>
                          </>
                        )}
                      </span>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>

          {video.visibility_status === "voided" ? (
            <div className={styles.warningBar}>
              <Icon name="warning" size={14} aria-hidden />
              <span>
                この作品は現在「調整中」です。投稿者本人と運営による確認後に公開状態が更新されます。
              </span>
            </div>
          ) : null}

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

          {events.length > 1 ? (
            <div className="fn-vd-event-tags" aria-label="その他の所属イベント">
              <span className="fn-vd-event-tags-label">他の所属</span>
              {events
                .filter((e) => !primaryEvent || e.id !== primaryEvent.id)
                .map((e) => (
                  <Link
                    key={e.id}
                    href={`/event/${e.id}`}
                    className="fn-badge fn-badge-soft"
                  >
                    {e.title}
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
            {softwareLabel ? (
              <InlineMetaItem title="使用ソフト">{softwareLabel}</InlineMetaItem>
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
            </div>
          </div>

          {members.length > 0 ? (
            <section className={`${styles.section} ${styles.membersBlock}`}>
              <h2 className={styles.sectionTitle}>
                参加メンバー ({members.length})
              </h2>
              <MemberSection
                members={members}
                memberChapters={memberChapters.map((chapter) => ({
                  id: chapter.id,
                  chapter_time: chapter.chapter_time,
                  chapter_label: chapter.chapter_label,
                  note: chapter.note,
                  video_member_id: chapter.video_member_id,
                }))}
              />
            </section>
          ) : null}
        </article>

        <aside className={styles.chapterRail} aria-label="チャプター">
          {playlist && playlistItems.length > 0 ? (
            <PlaylistRail
              label={playlistLabel}
              items={playlistItems}
              currentId={rawId}
              playlistId={playlist || undefined}
            />
          ) : null}

          <div className={styles.chapterBody}>
            <ChapterTabs
              chapters={chapters.map((chapter) => ({
                id: chapter.id,
                chapter_time: chapter.chapter_time,
                chapter_label: chapter.chapter_label,
                visibility: (
                  chapter.visibility ?? "public"
                ) as "public" | "private",
                marker_kind: "comment" as
                  | "comment"
                  | "chapter"
                  | "review"
                  | "system",
                note: chapter.note,
                author_name: chapter.author_name,
                author_icon: chapter.author_icon,
              }))}
            />
          </div>

          {viewerUser?.id ? (
            <ChapterComposer
              videoId={video.id}
              canPost={viewerXApproved}
              canBulk={false}
              settingsHref={`/dashboard/settings?next=${encodeURIComponent(
                `/${rawId}`,
              )}`}
            />
          ) : (
            <section className="fn-vd-login-panel">
              <span>
                <Icon
                  name="info"
                  size={12}
                  aria-hidden
                />
                ログインするとチャプターコメントを投稿できます。
              </span>
              <Link
                href={`/entry?next=${encodeURIComponent(
                  `/${rawId}`,
                )}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                ログイン
              </Link>
            </section>
          )}
        </aside>

        <aside className={styles.relatedRail} aria-label="関連動画">
          <h3 className={styles.relatedHeading}>
            関連動画
          </h3>
          <RelatedList
            videos={related}
            firstCount={18}
          />
        </aside>
      </div>
    </div>
  );
}

type VideoViewerOverlay = {
  viewerUser: Awaited<ReturnType<typeof getCurrentUser>>;
  likeActive: boolean;
  bookmarkActive: boolean;
  viewerXApproved: boolean;
  viewerCanEditChapters: boolean;
  creatorYoutubeChannelUrl: string | null;
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
  creatorXUserId,
  playlistEventTitle,
}: {
  rawId: string;
  videoId: string;
  playlist: string;
  creatorXUserId: string | null;
  playlistEventTitle?: string | null;
}): Promise<VideoViewerOverlay> {
  const emptyOverlay: VideoViewerOverlay = {
    viewerUser: null,
    likeActive: false,
    bookmarkActive: false,
    viewerXApproved: false,
    viewerCanEditChapters: false,
    creatorYoutubeChannelUrl: null,
    playlistLabel: "再生リスト",
    playlistItems: [],
  };

  let viewerUser: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    viewerUser = await getCurrentUser();
    if (!viewerUser) return emptyOverlay;

    const viewerActiveX = viewerUser.active_x_user_id ?? null;
    const overlay = await withDatabase(async (db) => {
      let viewerCanEditChapters = false;
      const probe = (
        await db
          .select()
          .from(videosTable)
          .where(
            rawId.length === 11
              ? eq(videosTable.youtube_video_id, rawId)
              : eq(videosTable.id, rawId),
          )
          .limit(1)
      )[0];
      if (probe) {
        viewerCanEditChapters = await canEditVideo({
          db,
          user: { id: viewerUser!.id, role: viewerUser!.role ?? null },
          video: probe,
          requiredKey: "video.chapter_admin",
          privilegeMode: resolveAdminOrEventVideoPrivilegeMode(viewerUser!.role),
        });
      }

      let likeActive = false;
      let bookmarkActive = false;
      let viewerXApproved = false;
      if (viewerActiveX) {
        const interactions = await db
          .select()
          .from(videoInteractions)
          .where(
            and(
              eq(videoInteractions.x_user_id, viewerActiveX),
              eq(videoInteractions.video_id, videoId),
            )!,
          );
        likeActive = interactions.some((i) => i.interaction_type === "like");
        bookmarkActive = interactions.some(
          (i) => i.interaction_type === "bookmark",
        );

        const xRow = (
          await db
            .select({ approval_status: xUsers.approval_status })
            .from(xUsers)
            .where(eq(xUsers.id, viewerActiveX))
            .limit(1)
        )[0];
        viewerXApproved = xRow?.approval_status === "approved";
      }

      let creatorYoutubeChannelUrl: string | null = null;
      if (creatorXUserId) {
        const creatorRow = (
          await db
            .select({ youtube_channel_url: xUsers.youtube_channel_url })
            .from(xUsers)
            .where(eq(xUsers.id, creatorXUserId))
            .limit(1)
        )[0];
        creatorYoutubeChannelUrl = creatorRow?.youtube_channel_url ?? null;
      }

      let playlistLabel = "再生リスト";
      let playlistItems: VideoViewerOverlay["playlistItems"] = [];

      if (playlist) {
        if (playlist === "lib-like" || playlist === "lib-bookmark") {
          if (viewerActiveX) {
            const kind = playlist === "lib-like" ? "like" : "bookmark";
            const myInteractions = await db
              .select({ video_id: videoInteractions.video_id })
              .from(videoInteractions)
              .where(
                and(
                  eq(videoInteractions.x_user_id, viewerActiveX),
                  eq(videoInteractions.interaction_type, kind),
                )!,
              );
            const ids = myInteractions.map((r) => r.video_id);
            if (ids.length > 0) {
              const rows = await db
                .select({
                  id: videosTable.id,
                  title: videosTable.title,
                  youtube_video_id: videosTable.youtube_video_id,
                  display_name: videosTable.creator_display_name,
                })
                .from(videosTable)
                .where(
                  and(
                    inArray(videosTable.id, ids),
                    eq(videosTable.visibility_status, "public"),
                  )!,
                )
                .orderBy(desc(videosTable.scheduled_time));
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
        creatorYoutubeChannelUrl,
        playlistLabel,
        playlistItems,
      };
    });

    if (!overlay) {
      return { ...emptyOverlay, viewerUser };
    }

    return {
      viewerUser,
      likeActive: overlay.likeActive,
      bookmarkActive: overlay.bookmarkActive,
      viewerXApproved: overlay.viewerXApproved,
      viewerCanEditChapters: overlay.viewerCanEditChapters,
      creatorYoutubeChannelUrl: overlay.creatorYoutubeChannelUrl,
      playlistLabel: overlay.playlistLabel,
      playlistItems: overlay.playlistItems,
    };
  } catch {
    return { ...emptyOverlay, viewerUser };
  }
}

function StaticVideoDetailView({
  detail,
  rawId,
  playlist = "",
  overlay,
}: {
  detail: StaticVideoDetail;
  rawId: string;
  playlist?: string;
  overlay?: VideoViewerOverlay | null;
}): React.ReactElement {
  const vm = buildPublicVideoViewModelFromStatic(detail);
  const { video } = vm;
  if (video.visibility_status !== "public") {
    notFound();
  }
  const viewerUser = overlay?.viewerUser ?? null;
  const viewerActiveX = viewerUser?.active_x_user_id ?? null;
  const likeActive = overlay?.likeActive ?? false;
  const bookmarkActive = overlay?.bookmarkActive ?? false;
  const viewerXApproved = overlay?.viewerXApproved ?? false;
  const creatorYoutubeChannelUrl = overlay?.creatorYoutubeChannelUrl ?? null;
  const playlistLabel = overlay?.playlistLabel ?? "再生リスト";
  const playlistItems = overlay?.playlistItems ?? [];
  const creatorIcon = video.creator_icon_url ?? null;
  const creatorId = video.creator_x_user_id ?? "anonymous";
  const creatorName =
    video.creator_display_name?.trim() ||
    (creatorId !== "anonymous" ? creatorId : "作者未設定");
  const creatorHref = creatorId !== "anonymous" ? `/user/${creatorId}` : null;
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
      {creatorIcon ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={creatorIcon} alt="" className={styles.authorIcon} />
      ) : (
        <span className={styles.authorIconFb}>
          <Icon name="user" size={18} aria-hidden />
        </span>
      )}
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
  const canInteract = !!(viewerUser?.id && viewerActiveX && viewerXApproved);

  return (
    <div
      className={`fn-vd fn-public-container fn-page ${styles.page}`}
      style={accentVar}
    >
      <JsonLd data={videoJsonLd} />
      <div className={styles.layout}>
        <article className={styles.main}>
          <div className={styles.heroLayout}>
            <div className={styles.playerPane}>
              {youtubeId ? (
                <YoutubePlayer youtubeId={youtubeId} title={video.title} />
              ) : (
                <div
                  className="fn-empty"
                  style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}
                >
                  <p>YouTube 動画 ID が登録されていません。</p>
                </div>
              )}
            </div>
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
                      {!viewerUser?.id ? (
                        <>
                          ログインするといいね、セーブができます。
                          <Link
                            href={`/entry?next=${encodeURIComponent(currentPath)}`}
                            className={styles.interactionHintLink}
                          >
                            ログイン
                          </Link>
                        </>
                      ) : !viewerActiveX ? (
                        <>
                          X IDを選択するといいね、セーブができます。
                          <Link
                            href={`/dashboard/settings?next=${encodeURIComponent(currentPath)}`}
                            className={styles.interactionHintLink}
                          >
                            X ID設定へ
                          </Link>
                        </>
                      ) : (
                        <>
                          承認済みX IDが必要です。
                          <Link
                            href={`/dashboard/settings?next=${encodeURIComponent(currentPath)}`}
                            className={styles.interactionHintLink}
                          >
                            X ID設定へ
                          </Link>
                        </>
                      )}
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
            </div>
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
                  comment: null,
                  x_name: null,
                  icon_url: null,
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
        </article>

        <aside className={styles.chapterRail} aria-label="チャプター">
          {playlist && playlistItems.length > 0 ? (
            <PlaylistRail
              label={playlistLabel}
              items={playlistItems}
              currentId={rawId}
              playlistId={playlist || undefined}
            />
          ) : null}

          <div className={styles.chapterBody}>
            <ChapterTabs
              chapters={vm.publicChapters.map((chapter) => ({
                id: chapter.id,
                chapter_time: chapter.chapter_time,
                chapter_label: chapter.chapter_label,
                visibility: "public" as const,
                marker_kind: "comment" as const,
                note: chapter.note,
                author_name: chapter.author_name,
                author_icon: chapter.author_icon,
              }))}
            />
          </div>

          {viewerUser?.id ? (
            <ChapterComposer
              videoId={video.id}
              canPost={viewerXApproved}
              canBulk={false}
              settingsHref={`/dashboard/settings?next=${encodeURIComponent(currentPath)}`}
            />
          ) : (
            <section className="fn-vd-login-panel">
              <span>
                <Icon name="info" size={12} aria-hidden />
                ログインするといいね、セーブ、チャプターコメントが使えます。
              </span>
              <Link
                href={`/entry?next=${encodeURIComponent(currentPath)}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                ログイン
              </Link>
            </section>
          )}
        </aside>

        <aside className={styles.relatedRail} aria-label="関連動画">
          <h3 className={styles.relatedHeading}>関連動画</h3>
          <RelatedList videos={vm.relatedVideos} firstCount={18} />
        </aside>
      </div>
    </div>
  );
}

function RelatedList({
  videos,
  firstCount,
}: {
  videos: VideoCardData[];
  firstCount: number;
}): React.ReactElement {
  return (
    <div className={styles.relatedList}>
      {videos.length === 0 ? (
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
