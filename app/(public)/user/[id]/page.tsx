import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import { customPages, videos, videoMembers, xUsers } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

interface ProfileUser {
  id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const data = await withDatabase(async (db) => {
    const u = await db
      .select()
      .from(xUsers)
      .where(eq(xUsers.id, id))
      .limit(1);
    if (u[0]) return { title: u[0].x_name };

    const fallback = await db
      .select({ name: sql<string>`COALESCE(${videos.display_name}, ${videos.contact_x_id})` })
      .from(videos)
      .where(
        and(
          eq(videos.status, "public"),
          eq(videos.is_deleted, 0),
          eq(videos.is_manual_hidden, 0),
          or(eq(videos.creator_id, id), eq(videos.contact_x_id, id))!,
        )!,
      )
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(1);
    return { title: fallback[0]?.name ?? id };
  });
  return data ?? { title: id };
}

export default async function UserPage({
  params,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);

  const bundle = await withDatabase(async (db) => {
    const userRow = await db
      .select()
      .from(xUsers)
      .where(eq(xUsers.id, id))
      .limit(1);
    const publicVideoBase = and(
      eq(videos.status, "public"),
      eq(videos.is_deleted, 0),
      eq(videos.is_manual_hidden, 0),
    );

    const fallbackUserRows = userRow[0]
      ? []
      : await db
          .select({
            id: videos.contact_x_id,
            x_name: sql<string>`COALESCE(${videos.display_name}, ${videos.contact_x_id})`,
            icon_url: videos.icon_url,
            profile_text: sql<string | null>`NULL`,
            youtube_channel_url: sql<string | null>`NULL`,
          })
          .from(videos)
          .where(
            and(
              publicVideoBase,
              or(eq(videos.creator_id, id), eq(videos.contact_x_id, id))!,
            )!,
          )
          .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
          .limit(1);

    const user: ProfileUser | null = userRow[0]
      ? {
          id: userRow[0].id,
          x_name: userRow[0].x_name,
          icon_url: userRow[0].icon_url,
          profile_text: userRow[0].profile_text,
          youtube_channel_url: userRow[0].youtube_channel_url,
        }
      : (fallbackUserRows[0] ?? null);
    if (!user) return null;

    const ownVideosRaw = await db
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
          publicVideoBase,
          or(eq(videos.creator_id, id), eq(videos.contact_x_id, id))!,
        )!,
      )
      .orderBy(desc(videos.scheduled_time));

    const ownVideos = ownVideosRaw.map((v) => ({
      ...v,
      display_name: user.x_name || v.display_name || user.id,
      icon_url: v.icon_url ?? user.icon_url,
    })) as VideoCardData[];

    const collabVideos = (await db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
        icon_url: sql<
          string | null
        >`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`,
        creator_id: videos.creator_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.status,
      })
      .from(videos)
      .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(
        and(
          publicVideoBase,
          eq(videoMembers.x_user_id, id),
          ne(videos.creator_id, id),
        )!,
      )
      .orderBy(desc(videos.scheduled_time))
      .limit(40)) as VideoCardData[];

    const portfolio = (
      await db
        .select({ id: customPages.id })
        .from(customPages)
        .where(and(eq(customPages.x_user_id, user.id), eq(customPages.is_published, 1))!)
        .limit(1)
    )[0];

    return { user, ownVideos, collabVideos, portfolio };
  });

  if (!bundle) notFound();
  const { user, ownVideos, collabVideos, portfolio } = bundle;

  // 派生情報 (withDatabase closure 外で表示用に整形)
  const profileIcon = user.icon_url ?? null;
  const profileName = user.x_name || user.id;

  return (
    <div className={styles.page}>
      <section className={styles.profile}>
        {profileIcon ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profileIcon} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarFb}>
            <Icon name="user" size={36} aria-hidden />
          </span>
        )}
        <div className={styles.profileBody}>
          <p className={styles.eyebrow}>CREATOR</p>
          <h1 className={styles.name}>{profileName}</h1>
          <p className={styles.handle}>@{user.id}</p>
          {user.profile_text ? (
            <p className={styles.bio}>{user.profile_text}</p>
          ) : null}
          <div className={styles.links}>
            <a
              href={`https://x.com/${user.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              aria-label={`X のプロフィール @${user.id} を開く`}
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
            {portfolio ? (
              <Link
                href={`/user/${user.id}/portfolio`}
                className="fn-btn fn-btn-primary fn-btn-sm"
              >
                <Icon name="grid" size={12} aria-hidden />
                Portfolio
              </Link>
            ) : null}
            <Link
              href={`/list?q=${encodeURIComponent(profileName)}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              関連作品
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>作品 ({ownVideos.length})</h2>
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
          <h2 className={styles.sectionTitle}>参加作品</h2>
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
