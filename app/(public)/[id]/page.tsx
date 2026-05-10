import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  fetchRelatedVideos,
  fetchVideoDetail,
} from "@/lib/db/videoDetailQueries";
import { extractYoutubeId } from "@/lib/youtube/id";
import { YoutubePlayer } from "@/components/video/YoutubePlayer";
import { ChapterTabs } from "@/components/video/ChapterTabs";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
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
}: Props): Promise<React.ReactElement> {
  const { id: rawId } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const detail = await fetchVideoDetail(db, rawId);
  if (!detail) notFound();
  const { video, creator, events, members, chapters, comments } = detail;

  // YouTubeID 登録済みなら UUID アクセスを正規 URL に 308 リダイレクト
  if (
    video.youtube_video_id &&
    rawId !== video.youtube_video_id &&
    rawId === video.id
  ) {
    redirect(`/${video.youtube_video_id}`);
  }

  // 公開不可作品の制御
  if (
    video.status !== "public" &&
    video.status !== "x_reapply_required" &&
    video.status !== "unlisted"
  ) {
    notFound();
  }

  const youtubeId =
    video.youtube_video_id ?? extractYoutubeId(rawId) ?? null;

  const accentColor =
    events.find((e) => e.id === video.primary_event_id)?.accent_color ?? null;
  const accentVar = accentColor
    ? ({ ["--event-accent" as never]: accentColor } as React.CSSProperties)
    : undefined;

  const chapterMarkers = chapters
    .filter(
      (c) => c.show_on_player_bar === 1 || c.marker_kind === "chapter",
    )
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
            <Link
              href={creator ? `/user/${creator.id}` : "#"}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              {creator?.icon_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={creator.icon_url}
                  alt=""
                  className={styles.authorIcon}
                />
              ) : (
                <span className={styles.authorIconFb}>
                  <Icon name="user" size={18} aria-hidden />
                </span>
              )}
              <span>
                <span className={styles.authorName}>
                  {video.display_name}
                </span>
                <span className={styles.authorMeta}>
                  {creator ? (
                    <>
                      <span>@{creator.id}</span>
                      <a
                        href={`https://x.com/${creator.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`X (@${creator.id}) を開く`}
                      >
                        <Icon name="external" size={11} aria-hidden />
                      </a>
                    </>
                  ) : null}
                  {video.scheduled_time ? (
                    <span>
                      公開: {formatUnix(video.scheduled_time, { dateOnly: true })}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
            <div className={styles.authorActions}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                aria-label="いいね"
              >
                <Icon name="heart" size={13} aria-hidden />
                いいね
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                aria-label="ブックマーク"
              >
                <Icon name="bookmark" size={13} aria-hidden />
                セーブ
              </button>
            </div>
          </div>

          {video.status === "x_reapply_required" ? (
            <div className={styles.warningBar}>
              <Icon name="warning" size={14} aria-hidden />
              <span>
                この作品は現在「調整中」です。投稿者本人と運営による確認が完了するまで、しばらくお待ちください。
              </span>
            </div>
          ) : video.status === "unlisted" ? (
            <div className={styles.warningBar}>
              <Icon name="info" size={14} aria-hidden />
              <span>限定公開作品です。リンク経由でのみ閲覧できます。</span>
            </div>
          ) : null}

          {events[0] ? (
            <div
              className={styles.eventBox}
              style={
                events[0].accent_color
                  ? ({
                      ["--event-accent" as never]: events[0].accent_color,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <span className={styles.eventBoxLabel}>イベント</span>
              <Link
                href={`/event/${events[0].id}`}
                className={styles.eventBoxTitle}
              >
                {events[0].title}
              </Link>
              {events[0].is_active === 1 ? (
                <span className="fn-badge fn-badge-accent">開催中</span>
              ) : events[0].is_archived === 1 ? (
                <span className="fn-badge fn-badge-neutral">アーカイブ</span>
              ) : null}
            </div>
          ) : null}

          <div className={styles.metaSection}>
            {video.music ? (
              <div className={styles.metaItem}>
                <h3>楽曲</h3>
                <p>
                  {video.music}
                  {video.credit ? ` / ${video.credit}` : ""}
                </p>
              </div>
            ) : null}
            {video.intro_comment ? (
              <div className={styles.metaItem}>
                <h3>紹介コメント</h3>
                <p>{video.intro_comment}</p>
              </div>
            ) : null}
            {video.highlights ? (
              <div className={styles.metaItem}>
                <h3>みどころ</h3>
                <p>{video.highlights}</p>
              </div>
            ) : null}
            {video.production_story ? (
              <div className={styles.metaItem}>
                <h3>制作エピソード</h3>
                <p>{video.production_story}</p>
              </div>
            ) : null}
            {video.used_software ? (
              <div className={styles.metaItem}>
                <h3>使用ソフト</h3>
                <p>{video.used_software}</p>
              </div>
            ) : null}
            {video.closing_comment ? (
              <div className={styles.metaItem}>
                <h3>あとがき</h3>
                <p>{video.closing_comment}</p>
              </div>
            ) : null}
          </div>

          {members.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                参加メンバー ({members.length})
              </h2>
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
                            <Link href={`/user/${m.x_user_id}`}>
                              @{m.x_user_id}
                            </Link>
                          ) : (
                            <span className="fn-muted">@—</span>
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

          <div>
            <h3 className={styles.relatedHeading}>関連動画</h3>
            <div className={styles.relatedList}>
              {related.length === 0 ? (
                <p
                  className="fn-empty-message"
                  style={{ padding: 8 }}
                >
                  関連動画はまだありません。
                </p>
              ) : (
                related.map((v) => (
                  <VideoCard key={v.id} video={v} size="list" />
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
