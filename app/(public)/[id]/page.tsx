import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import styles from "./page.module.css";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { videoInteractions, xUsers } from "@/lib/db/schema";
import {
  fetchEventPlaylistVideos,
  fetchRelatedVideos,
  fetchVideoDetail,
} from "@/lib/db/videoDetailQueries";
import { extractYoutubeId } from "@/lib/youtube/id";
import { YoutubePlayer } from "@/components/video/YoutubePlayer";
import { ChapterTabs } from "@/components/video/ChapterTabs";
import { ChapterComposer } from "@/components/video/ChapterComposer";
import { CommentComposer } from "@/components/video/CommentComposer";
import { PlaylistRail } from "@/components/video/PlaylistRail";
import { InteractionButton } from "@/components/video/InteractionButton";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ playlist?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: id };
  const detail = await fetchVideoDetail(db, id);
  if (!detail) return { title: id };
  return {
    title: `${detail.video.title} - ${detail.video.display_name}`,
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
  const db = getDatabase();
  if (!db) notFound();

  const detail = await fetchVideoDetail(db, rawId);
  if (!detail) notFound();
  const { video, creator, events, members, chapters, comments } = detail;

  if (
    video.youtube_video_id &&
    rawId !== video.youtube_video_id &&
    rawId === video.id
  ) {
    redirect(`/${video.youtube_video_id}${playlist ? `?playlist=${encodeURIComponent(playlist)}` : ""}`);
  }

  if (
    video.status !== "public" &&
    video.status !== "x_reapply_required" &&
    video.status !== "unlisted"
  ) {
    notFound();
  }

  const youtubeId = video.youtube_video_id ?? extractYoutubeId(rawId) ?? null;
  const primaryEvent = events.find((e) => e.id === video.primary_event_id) ?? events[0];
  const accentColor = primaryEvent?.accent_color ?? null;
  const accentVar = accentColor
    ? ({ ["--event-accent" as never]: accentColor } as React.CSSProperties)
    : undefined;

  const creatorId = creator?.id ?? video.creator_id ?? video.contact_x_id;
  const creatorName = creator?.x_name ?? video.display_name ?? creatorId;
  const creatorIcon = creator?.icon_url ?? video.icon_url ?? null;
  const creatorHref = creatorId && creatorId !== "anonymous" ? `/user/${creatorId}` : null;

  const chapterMarkers = chapters
    .filter((c) => c.show_on_player_bar === 1 || c.marker_kind === "chapter")
    .map((c) => ({
      id: c.id,
      time: c.chapter_time,
      label: c.chapter_label,
      visibility: (c.visibility ?? "public") as "public" | "private",
      marker_kind: (c.marker_kind ?? "comment") as
        | "comment"
        | "chapter"
        | "review"
        | "system",
    }));

  const related = (await fetchRelatedVideos(db, {
    id: video.id,
    creator_id: video.creator_id,
    primary_event_id: video.primary_event_id,
  })) as VideoCardData[];

  const session = await auth().catch(() => null);
  const viewerUser = session?.user as
    | { id?: string; active_x_user_id?: string | null }
    | undefined;
  const viewerActiveX = viewerUser?.active_x_user_id ?? null;
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
          eq(videoInteractions.video_id, video.id),
        )!,
      );
    likeActive = interactions.some((i) => i.interaction_type === "like");
    bookmarkActive = interactions.some((i) => i.interaction_type === "bookmark");

    // チャプター/コメント投稿許可は「承認済 X ID」必須
    const xRow = (
      await db
        .select({ approval_status: xUsers.approval_status })
        .from(xUsers)
        .where(eq(xUsers.id, viewerActiveX))
        .limit(1)
    )[0];
    viewerXApproved = xRow?.approval_status === "approved";
  }

  let playlistId = playlist || video.primary_event_id || "";
  let playlistLabel = "再生リスト";
  let playlistItems: {
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
  }[] = [];

  if (playlistId) {
    const evVideos = await fetchEventPlaylistVideos(db, playlistId);
    if (evVideos.length > 1) {
      const eventTitle =
        events.find((e) => e.id === playlistId)?.title ??
        primaryEvent?.title ??
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

  if (playlistItems.length === 0 && related.length > 0) {
    playlistId = "";
    playlistLabel = "おすすめ再生リスト";
    playlistItems = [
      {
        id: video.id,
        title: video.title,
        youtube_video_id: video.youtube_video_id,
        display_name: creatorName,
      },
      ...related.slice(0, 12).map((v) => ({
        id: v.id,
        title: v.title,
        youtube_video_id: v.youtube_video_id,
        display_name: v.display_name,
      })),
    ];
  }

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
            <>
              <span>@{creatorId}</span>
              <a
                href={`https://x.com/${creatorId}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`X (@${creatorId}) を開く`}
              >
                <Icon name="external" size={11} aria-hidden />
              </a>
            </>
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
            <div className={styles.authorActions}>
              <InteractionButton
                videoId={video.id}
                kind="like"
                initialActive={likeActive}
                count={video.like_count ?? 0}
                canInteract={!!viewerActiveX}
              />
              <InteractionButton
                videoId={video.id}
                kind="bookmark"
                initialActive={bookmarkActive}
                canInteract={!!viewerActiveX}
              />
            </div>
          </div>

          {video.status === "x_reapply_required" ? (
            <div className={styles.warningBar}>
              <Icon name="warning" size={14} aria-hidden />
              <span>この作品は現在「調整中」です。投稿者本人と運営による確認後に公開状態が更新されます。</span>
            </div>
          ) : video.status === "unlisted" ? (
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
                  ? ({ ["--event-accent" as never]: primaryEvent.accent_color } as React.CSSProperties)
                  : undefined
              }
            >
              <span className={styles.eventBoxLabel}>イベント</span>
              <Link href={`/event/${primaryEvent.id}`} className={styles.eventBoxTitle}>
                {primaryEvent.title}
              </Link>
              {primaryEvent.is_active === 1 ? (
                <span className="fn-badge fn-badge-accent">開催中</span>
              ) : primaryEvent.is_archived === 1 ? (
                <span className="fn-badge fn-badge-neutral">アーカイブ</span>
              ) : null}
            </div>
          ) : null}

          <div className={styles.metaSection}>
            {video.music ? <MetaItem title="楽曲" body={`${video.music}${video.credit ? ` / ${video.credit}` : ""}`} /> : null}
            {video.intro_comment ? <MetaItem title="紹介コメント" body={video.intro_comment} /> : null}
            {video.highlights ? <MetaItem title="みどころ" body={video.highlights} /> : null}
            {video.production_story ? <MetaItem title="制作エピソード" body={video.production_story} /> : null}
            {video.used_software ? <MetaItem title="使用ソフト" body={video.used_software} /> : null}
            {video.closing_comment ? <MetaItem title="あとがき" body={video.closing_comment} /> : null}
          </div>

          {members.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>参加メンバー ({members.length})</h2>
              <div className={styles.memberTable}>
                <table className="fn-table">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Name</th>
                      <th>ID</th>
                      <th>担当 / コメント</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, i) => (
                      <tr key={m.id}>
                        <td>{i + 1}</td>
                        <td>{m.x_name ?? m.name}</td>
                        <td>
                          {m.x_user_id ? (
                            <Link href={`/user/${m.x_user_id}`}>@{m.x_user_id}</Link>
                          ) : (
                            <span className="fn-muted">-</span>
                          )}
                        </td>
                        <td>
                          {m.role ? <strong>{m.role}</strong> : null}
                          {m.role && m.comment ? " / " : ""}
                          {m.comment ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </article>

        <aside className={styles.aside}>
          {playlistItems.length > 1 ? (
            <PlaylistRail
              label={playlistLabel}
              items={playlistItems}
              currentId={rawId}
              playlistId={playlistId || undefined}
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
            comments={comments.map((c) => ({
              id: c.id,
              body: c.body,
              created_at: c.created_at,
              chapter_time: c.chapter_time,
              chapter_label: c.chapter_label,
              author_name: c.author_name,
              author_icon: c.author_icon,
            }))}
          />

          {viewerUser?.id ? (
            <>
              <ChapterComposer videoId={video.id} canPost={viewerXApproved} />
              <CommentComposer
                videoId={video.id}
                canPost={viewerXApproved}
                chapterOptions={chapters.map((c) => ({
                  id: c.id,
                  chapter_time: c.chapter_time,
                  chapter_label: c.chapter_label,
                }))}
              />
            </>
          ) : null}

          <div>
            <h3 className={styles.relatedHeading}>関連動画</h3>
            <div className={styles.relatedList}>
              {related.length === 0 ? (
                <p className="fn-empty-message" style={{ padding: 8 }}>
                  関連動画はまだありません。
                </p>
              ) : (
                related.map((v) => <VideoCard key={v.id} video={v} size="list" />)
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
  body: string;
}): React.ReactElement {
  return (
    <div className={styles.metaItem}>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
