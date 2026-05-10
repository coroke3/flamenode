import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, or } from "drizzle-orm";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import { videos, videoMembers, xUsers } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: id };
  const u = await db
    .select()
    .from(xUsers)
    .where(eq(xUsers.id, id))
    .limit(1);
  return { title: u[0]?.x_name ?? id };
}

export default async function UserPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const userRow = await db
    .select()
    .from(xUsers)
    .where(eq(xUsers.id, id))
    .limit(1);
  const user = userRow[0];
  if (!user) notFound();

  const ownVideos = (await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: videos.display_name,
      icon_url: videos.icon_url,
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      status: videos.status,
    })
    .from(videos)
    .where(
      and(
        eq(videos.creator_id, id),
        eq(videos.status, "public"),
        eq(videos.is_deleted, 0),
        eq(videos.is_manual_hidden, 0),
      )!,
    )
    .orderBy(desc(videos.scheduled_time))) as VideoCardData[];

  const collabVideos = (await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: videos.display_name,
      icon_url: videos.icon_url,
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      status: videos.status,
    })
    .from(videos)
    .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
    .where(
      and(
        eq(videoMembers.x_user_id, id),
        eq(videos.status, "public"),
        eq(videos.is_deleted, 0),
      )!,
    )
    .orderBy(desc(videos.scheduled_time))
    .limit(40)) as VideoCardData[];

  return (
    <div className={styles.page}>
      <section className={styles.profile}>
        {user.icon_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={user.icon_url} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarFb}>
            <Icon name="user" size={36} aria-hidden />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className={styles.name}>{user.x_name}</h1>
          <p className={styles.handle}>@{user.id}</p>
          {user.profile_text ? (
            <p className={styles.bio} style={{ marginTop: 10 }}>
              {user.profile_text}
            </p>
          ) : null}
          <div className={styles.links} style={{ marginTop: 14 }}>
            <a
              href={`https://x.com/${user.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              aria-label={`X (Twitter) のプロフィール @${user.id} を開く`}
            >
              <Icon name="external" size={12} aria-hidden />X
            </a>
            {user.youtube_channel_url ? (
              <a
                href={user.youtube_channel_url}
                target="_blank"
                rel="noopener noreferrer"
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="youtube" size={12} aria-hidden />
                YouTube
              </a>
            ) : null}
            <Link
              href={`/list?q=${encodeURIComponent(user.x_name)}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              関連作品
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          作品 ({ownVideos.length})
        </h2>
        {ownVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="info" size={20} aria-hidden />
            <p className="fn-empty-message">
              まだ公開されている作品がありません。
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {ownVideos.map((v) => (
              <div key={v.id}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        )}
      </section>

      {collabVideos.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>合作参加</h2>
          <div className={styles.grid}>
            {collabVideos.map((v) => (
              <div key={v.id}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
