import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { buildAccentVars } from "@/lib/theme/accent";
import styles from "./page.module.css";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getApprovedXIds, canEditVideo } from "@/lib/auth/ownership";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import {
  videoInteractions,
  videos as videosTable,
  videoStats,
  xUsers,
} from "@/lib/db/schema";
import {
  fetchEventPlaylistVideos,
  fetchRelatedVideos,
  fetchVideoDetail,
} from "@/lib/db/videoDetailQueries";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { extractYoutubeId } from "@/lib/youtube/id";
import { YoutubePlayer } from "@/components/video/YoutubePlayer";
import { ChapterTabs } from "@/components/video/ChapterTabs";
import { ChapterComposer } from "@/components/video/ChapterComposer";
import { IntroCommentBlock } from "@/components/video/IntroCommentBlock";
import { PlaylistRail } from "@/components/video/PlaylistRail";
import { InteractionButton } from "@/components/video/InteractionButton";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { MemberSection } from "@/components/video/MemberSection";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ playlist?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await withDatabase(async (db) => {
    return fetchVideoDetail(db, id);
  });
  if (!detail) return { title: id };
  return {
    title: `${detail.video.title} - ${detail.video.creator_display_name}`,
    openGraph: {
      images: detail.video.youtube_video_id
        ? [`https://i.ytimg.com/vi/${detail.video.youtube_video_id}/maxresdefault.jpg`]
        : undefined,
    },
  };
}

export default async function VideoDetailPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id: rawId } = await params;
  const { playlist = "" } = (await searchParams) ?? {};

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
    const statsRow =
      (
        await db
          .select()
          .from(videoStats)
          .where(eq(videoStats.video_id, detail.video.id))
          .limit(1)
      )[0] ?? null;

    const related = (await fetchRelatedVideos(db, {
      id: detail.video.id,
      creator_x_user_id: detail.video.creator_x_user_id,
      primary_event_id: detail.video.primary_event_id,
      scheduled_time: detail.video.scheduled_time,
      eventIds: detail.events.map((event) => event.id),
    }, 30)) as VideoCardData[];

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
      bookmarkActive = interactions.some((i) => i.interaction_type === "bookmark");

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
            const { videos: videosTable } = await import("@/lib/db/schema");
            const { inArray } = await import("drizzle-orm");
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
                  ne(videosTable.visibility_status, "archived"),
                )!,
              );
            playlistLabel = kind === "like" ? "いいねした作品" : "セーブした作品";
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
            detail.events.find((e) => e.id === detail.video.primary_event_id)?.title ??
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
      viewerCanEditChapters,
      softwareLabel,
      stats: statsRow,
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
    viewerCanEditChapters,
    softwareLabel,
    stats,
    playlistLabel,
    playlistItems,
  } = bundle;

  const creatorIcon = creator?.icon_url ?? video.creator_icon_url ?? null;
  const creatorName =
    creator?.x_name ?? video.creator_display_name ?? "作者未設定";
  const creatorId = creator?.id ?? video.creator_x_user_id ?? "anonymous";
  const creatorHref = creator?.id && creator.id !== "anonymous" ? `/user/${creator.id}` : null;
  const youtubeId = video.youtube_video_id ? extractYoutubeId(video.youtube_video_id) : null;

  const primaryEvent = events.find((e) => e.id === video.primary_event_id) ?? events[0] ?? null;
  const primaryEventStatus = primaryEvent ? computeEventStatus(primaryEvent) : null;
  const accentColor = primaryEvent?.accent_color ?? "#ffd100";
  // accent_color (hex) を HSL クランプして 5 種の CSS 変数にする。
  // - event_accent: 本体色
  // - event_accent_strong: ホバー強調
  // - event_accent_soft: 背面グロー (半透明)
  // - event_accent_text: アクセント面に乗せる文字色
  // - event_accent_ring: 枠線 / フォーカス
  const accentVar = primaryEvent?.accent_color
    ? buildAccentVars(primaryEvent.accent_color, "dark")
    : undefined;

  const chapterMarkers = chapters.map((c) => ({
    id: c.id,
    time: c.chapter_time,
    label: c.chapter_label,
    visibility: (c.visibility ?? "public") as "public" | "private",
    marker_kind: (c.marker_kind ?? "comment") as "comment" | "chapter" | "review" | "system",
    note: c.note,
    author_name: c.author_name,
    author_icon: c.author_icon,
  }));

  const authorBlock = (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

  // 投稿者行のリンク群: FlameNode / X / YouTube。
  // すべて authorBlock の外側に出して a タグのネストを避ける。
  // 投稿者名 / @id は authorBlock 全体を包む内部 Link で /user/[id] に飛ばす。
  // - FlameNode プロフィール: creatorHref があるときだけ表示 (内部リンク)
  // - X 外部リンク: creatorId が anonymous でないときだけ表示 (外部リンク)
  // - YouTube リンク: creator.youtube_channel_url があるときだけ表示 (外部リンク)
  // 黄色 CTA は使わず、丸い fn-icon-btn で控えめに並べる。
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
    <div className={styles.page} style={accentVar}>
      <div className={styles.layout}>
        <article className={styles.main}>
          {youtubeId ? (
            <YoutubePlayer
              youtubeId={youtubeId}
              title={video.title}
              chapters={chapterMarkers}
              accentColor={accentColor}
            />
          ) : (
            <div
              className="fn-empty"
              style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}
            >
              <p>YouTube 動画 ID が登録されていません。</p>
            </div>
          )}

          <h1 className={styles.title}>{video.title}</h1>

          <div className={styles.author}>
            {creatorHref ? (
              <Link href={creatorHref}>{authorBlock}</Link>
            ) : (
              authorBlock
            )}
            {authorLinkGroup}
            <div className={styles.authorActions}>
              {(() => {
                // いいね・セーブの実行可否はサーバー側 writeGuard と合わせて
                // viewerXApproved (承認済み Active X ID) を基準にする。
                // 未ログイン・未選択・未承認それぞれに合わせた CTA を出して、
                // 「押せるけど失敗する」を避ける。
                const currentPath = `/${rawId}`;
                const interactionGate: {
                  canInteract: boolean;
                  disabledReason?: string;
                  actionHref?: string;
                } = !viewerUser?.id
                  ? {
                      canInteract: false,
                      disabledReason: "ログインするといいねできます。",
                      actionHref: `/entry?next=${encodeURIComponent(currentPath)}`,
                    }
                  : !viewerActiveX
                    ? {
                        canInteract: false,
                        disabledReason: "X IDを選択するといいねできます。",
                        actionHref: `/dashboard/settings?next=${encodeURIComponent(currentPath)}`,
                      }
                    : !viewerXApproved
                      ? {
                          canInteract: false,
                          disabledReason: "承認済みX IDが必要です。",
                          actionHref: `/dashboard/settings?next=${encodeURIComponent(currentPath)}`,
                        }
                      : { canInteract: true };
                return (
                  <>
                    <InteractionButton
                      videoId={video.id}
                      kind="like"
                      initialActive={likeActive}
                      count={stats?.app_like_count ?? 0}
                      {...interactionGate}
                    />
                    <InteractionButton
                      videoId={video.id}
                      kind="bookmark"
                      initialActive={bookmarkActive}
                      {...interactionGate}
                    />
                  </>
                );
              })()}
            </div>
          </div>

          {video.visibility_status === "voided" ? (
            <div className={styles.warningBar}>
              <Icon name="warning" size={14} aria-hidden />
              <span>この作品は現在「調整中」です。投稿者本人と運営による確認後に公開状態が更新されます。</span>
            </div>
          ) : video.visibility_status === "limited" ? (
            <div className={styles.warningBar}>
              <Icon name="info" size={14} aria-hidden />
              <span>限定公開作品です。リンクを知っている人のみ閲覧できます。</span>
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
          {/* primary 以外の所属イベントもチップで表示する。
              video_events 経由で複数イベントに紐付けされた作品は、ここで
              「他にも参加しているイベント」が一目で見えるようにする。 */}
          {events.length > 1 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
                fontSize: 12,
              }}
              aria-label="その他の所属イベント"
            >
              <span style={{ color: "var(--text-muted)" }}>他の所属:</span>
              {events
                .filter((e) => !primaryEvent || e.id !== primaryEvent.id)
                .map((e) => (
                  <Link
                    key={e.id}
                    href={`/event/${e.id}`}
                    className="fn-badge fn-badge-soft"
                    style={{ textDecoration: "none" }}
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
                  // music_reference_url がある場合は「楽曲名 / 作曲者」全体を 1 つの
                  // 外部リンクとして包み、外部リンクアイコンを末尾に添える。
                  <a
                    href={video.music_reference_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
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
              <InlineMetaItem title="使用ソフト">
                {softwareLabel}
              </InlineMetaItem>
            ) : null}
            {/* みどころ / 制作エピソード / あとがき を 1 つの「詳細コメント」開閉エリアにまとめる。
                どれか 1 つでもあれば表示。初期状態は閉じる。 */}
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
                      <p style={{ margin: "4px 0 0", lineHeight: 1.7 }}>
                        {video.production_story}
                      </p>
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

          {/* モバイル: メタの後・メンバー前に関連動画を出す (下部に押し込みすぎない) */}
          <aside className={styles.relatedMobile} aria-label="関連動画 (モバイル表示)">
            <h3 className={styles.relatedHeading}>関連動画</h3>
            <div className={styles.relatedList}>
              {related.length === 0 ? (
                <p className="fn-empty-message" style={{ padding: 8 }}>
                  関連動画はまだありません。
                </p>
              ) : (
                <>
                  {related.slice(0, 8).map((v) => (
                    <VideoCard key={`${v.id}-mobile-related`} video={v} size="list" />
                  ))}
                  {related.length > 8 ? (
                    <details className={styles.relatedMore}>
                      <summary>さらに表示</summary>
                      <div className={styles.relatedList}>
                        {related.slice(8, 30).map((v) => (
                          <VideoCard
                            key={`${v.id}-mobile-related-more`}
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
          </aside>

          {members.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>参加メンバー ({members.length})</h2>
              <MemberSection
                members={members}
                memberChapters={memberChapters.map((c) => ({
                  id: c.id,
                  chapter_time: c.chapter_time,
                  chapter_label: c.chapter_label,
                  note: c.note,
                  video_member_id: c.video_member_id,
                }))}
              />
            </section>
          ) : null}
        </article>

        <aside className={styles.aside}>
          {playlist && playlistItems.length > 0 ? (
            <PlaylistRail
              label={playlistLabel}
              items={playlistItems}
              currentId={rawId}
              playlistId={playlist || undefined}
            />
          ) : null}

          <ChapterTabs
            chapters={chapters.map((c) => ({
              id: c.id,
              chapter_time: c.chapter_time,
              chapter_label: c.chapter_label,
              visibility: (c.visibility ?? "public") as "public" | "private",
              marker_kind: (c.marker_kind ?? "comment") as
                | "comment"
                | "chapter"
                | "review"
                | "system",
              note: c.note,
              author_name: c.author_name,
              author_icon: c.author_icon,
            }))}
          />

          {/*
            通常のチャプターコメントは動画詳細ページから投稿する仕様に戻す。
            メンバーチャプターは編集ページ側の VideoMembersField で管理するため
            ここには出さない。
          */}
          {viewerUser?.id ? (
            <ChapterComposer
              videoId={video.id}
              canPost={viewerXApproved}
              /*
                CSV 一括登録は動画編集ページ専用に移設したため、動画詳細ページ
                からは出さない。ここではログイン済みユーザーの単発投稿のみ提供する。
              */
              canBulk={false}
              settingsHref={`/dashboard/settings?next=${encodeURIComponent(`/${rawId}`)}`}
            />
          ) : (
            <section
              style={{
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-card)",
                borderRadius: "var(--radius-md)",
                padding: 12,
                fontSize: 12,
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>
                <Icon name="info" size={12} aria-hidden />{" "}
                ログインするとチャプターコメントを投稿できます。
              </span>
              <Link
                href={`/entry?next=${encodeURIComponent(`/${rawId}`)}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                ログイン
              </Link>
            </section>
          )}

          <div className={styles.relatedDesktop}>
            <h3 className={styles.relatedHeading}>関連動画</h3>
            <div className={styles.relatedList}>
              {related.length === 0 ? (
                <p className="fn-empty-message" style={{ padding: 8 }}>
                  関連動画はまだありません。
                </p>
              ) : (
                <>
                  {related.slice(0, 18).map((v) => (
                    <VideoCard key={`${v.id}-desktop-related`} video={v} size="list" />
                  ))}
                  {related.length > 18 ? (
                    <details className={styles.relatedMore}>
                      <summary>さらに表示</summary>
                      <div className={styles.relatedList}>
                        {related.slice(18, 30).map((v) => (
                          <VideoCard
                            key={`${v.id}-desktop-related-more`}
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
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetaItem({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}): React.ReactElement {
  return (
    <details className={styles.metaItem}>
      <summary>{title}</summary>
      <p>{body}</p>
    </details>
  );
}

/**
 * InlineMetaItem: 開閉なしの常時表示メタ項目。
 * 楽曲・クレジット・紹介コメント・使用ソフトのように、ページを開いた瞬間に
 * 見えていてほしいメタ情報用。
 */
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
