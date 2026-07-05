import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { JsonLd } from "@/components/seo/JsonLd";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveXUserIcon } from "@/lib/db/xIconResolution";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, totalPagesFor } from "@/lib/utils/sql";
import { absoluteUrl, buildPageMetadata, compactText } from "@/lib/seo";
import { coalescedVideoScore } from "@/lib/db/videoScoreSql";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { parseSocialLinks } from "@/lib/socialLinks";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { countablePublicVideoCondition } from "@/lib/db/queries";
import { storedCreatorNameExpr } from "@/lib/db/displayExpr";
import { ProfileSocialLinks } from "@/components/user/ProfileSocialLinks";

export const dynamic = "force-dynamic";

const WORKS_PAGE_SIZE = 24;
const COLLAB_PAGE_SIZE = 24;

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    worksPage?: string;
    collabPage?: string;
  }>;
}

interface ProfileUser {
  id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  portfolio_contact: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
  creative_start_date: number | null;
  approval_requested_at: number | null;
}

type CreatorVideo = VideoCardData & { score: number };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const data = await withDatabase(async (db) => {
    const u = await db
      .select()
      .from(xUsers)
      .where(sql`lower(${xUsers.id}) = ${id}`)
      .limit(1);
    if (u[0]) {
      return {
        title: u[0].x_name,
        description: u[0].profile_text,
        image: cachedGoogleImageUrl(u[0].icon_url),
      };
    }

    const fallback = await db
      .select({
        name: sql<string>`COALESCE(${videos.creator_display_name}, ${videos.creator_x_user_id})`,
        icon_url: videos.creator_icon_url,
      })
      .from(videos)
      .where(
        and(
          eq(videos.visibility_status, "public"),
          sql`lower(${videos.creator_x_user_id}) = ${id}`,
        )!,
      )
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(1);
    return {
      title: fallback[0]?.name ?? id,
      description: null,
      image: cachedGoogleImageUrl(fallback[0]?.icon_url),
    };
  });
  return buildPageMetadata({
    title: `${data?.title ?? id} - クリエイター`,
    description:
      data?.description ??
      `FlameNodeで公開されている${data?.title ?? id}の作品。`,
    path: `/user/${id}`,
    image: data?.image,
  });
}

function formatScore(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export default async function UserPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  const sp = (await searchParams) ?? {};
  const worksPaging = clampPaging({
    page: sp.worksPage,
    pageSize: WORKS_PAGE_SIZE,
    defaultPageSize: WORKS_PAGE_SIZE,
    maxPageSize: WORKS_PAGE_SIZE,
  });
  const collabPaging = clampPaging({
    page: sp.collabPage,
    pageSize: COLLAB_PAGE_SIZE,
    defaultPageSize: COLLAB_PAGE_SIZE,
    maxPageSize: COLLAB_PAGE_SIZE,
  });

  const bundle = await withDatabase(async (db) => {
    const userRow = await db
      .select()
      .from(xUsers)
      .where(sql`lower(${xUsers.id}) = ${id}`)
      .limit(1);
    const publicVideoBase = countablePublicVideoCondition;

    const fallbackUserRows = userRow[0]
      ? []
      : await db
          .select({
            id: sql<string>`${videos.creator_x_user_id}`,
            x_name: sql<string>`COALESCE(${videos.creator_display_name}, ${videos.creator_x_user_id})`,
            icon_url: videos.creator_icon_url,
            profile_text: sql<string | null>`NULL`,
            portfolio_contact: sql<string | null>`NULL`,
            youtube_channel_url: sql<string | null>`NULL`,
            other_social_links: sql<string | null>`NULL`,
            creative_start_date: sql<number | null>`NULL`,
            approval_requested_at: sql<number | null>`NULL`,
          })
          .from(videos)
          .where(and(publicVideoBase, sql`lower(${videos.creator_x_user_id}) = ${id}`)!)
          .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
          .limit(1);

    const user: ProfileUser | null = userRow[0]
      ? {
          id: userRow[0].id,
          x_name: userRow[0].x_name,
          icon_url: userRow[0].icon_url,
          profile_text: userRow[0].profile_text,
          portfolio_contact: userRow[0].portfolio_contact,
          youtube_channel_url: userRow[0].youtube_channel_url,
          other_social_links: userRow[0].other_social_links,
          creative_start_date: userRow[0].creative_start_date,
          approval_requested_at: userRow[0].approval_requested_at,
        }
      : (fallbackUserRows[0] ?? null);
    if (!user) return null;

    if (!user.icon_url) {
      const resolved = await resolveXUserIcon(db, user.id);
      if (resolved) user.icon_url = resolved;
    }

    const ownWhere = and(
      publicVideoBase,
      sql`lower(${videos.creator_x_user_id}) = ${id}`,
    )!;
    const ownVideoSelect = {
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: videos.creator_display_name,
      icon_url: videos.creator_icon_url,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      status: videos.visibility_status,
      part: videos.part,
      score: coalescedVideoScore,
    };

    const ownVideosRaw = await db
      .select(ownVideoSelect)
      .from(videos)
      .where(ownWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(worksPaging.pageSize)
      .offset(worksPaging.offset);

    const ownCountRow = (
      await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(videos)
        .where(ownWhere)
        .limit(1)
    )[0];
    const ownTotal = Number(ownCountRow?.c ?? 0);

    const ownVideos = ownVideosRaw.map((v) => ({
      ...v,
      score: Number(v.score ?? 0),
    })) as CreatorVideo[];

    const collabWhere = and(
      publicVideoBase,
      sql`lower(${videoMembers.x_user_id}) = ${id}`,
      sql`lower(${videos.creator_x_user_id}) <> ${id}`,
    )!;
    const collabVideos = (await db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: storedCreatorNameExpr,
        icon_url: videos.creator_icon_url,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
        part: videos.part,
        score: coalescedVideoScore,
      })
      .from(videos)
      .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
      .where(collabWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(collabPaging.pageSize)
      .offset(collabPaging.offset)) as CreatorVideo[];
    const collabCountRow = (
      await db
        .select({ c: sql<number>`COUNT(DISTINCT ${videos.id})` })
        .from(videos)
        .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
        .where(collabWhere)
        .limit(1)
    )[0];
    const collabTotal = Number(collabCountRow?.c ?? 0);

    return {
      user,
      ownVideos,
      ownTotal,
      collabVideos,
      collabTotal,
    };
  });

  if (!bundle) notFound();
  const {
    user,
    ownVideos,
    ownTotal,
    collabVideos,
    collabTotal,
  } = bundle;
  const ownTotalPages = totalPagesFor(ownTotal, worksPaging.pageSize);
  const collabTotalPages = totalPagesFor(collabTotal, collabPaging.pageSize);
  const basePath = `/user/${encodeURIComponent(user.id)}`;
  const buildOwnHref = (p: number) => {
    const usp = new URLSearchParams();
    usp.set("worksPage", String(p));
    return `${basePath}?${usp.toString()}`;
  };
  const buildCollabHref = (p: number) => {
    const usp = new URLSearchParams();
    usp.set("collabPage", String(p));
    return `${basePath}?${usp.toString()}`;
  };

  const profileIcon = cachedGoogleImageUrl(user.icon_url);
  const profileName = user.x_name || user.id;
  const socialLinks = parseSocialLinks(user.other_social_links);
  const portfolioContact = normalizePortfolioContact(user.portfolio_contact);
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profileName,
    alternateName: `@${user.id}`,
    description: compactText(user.profile_text),
    image: profileIcon ? absoluteUrl(profileIcon) : undefined,
    url: absoluteUrl(`/user/${user.id}`),
    sameAs: [
      `https://x.com/${user.id}`,
      user.youtube_channel_url,
      ...socialLinks.map((link) => link.url),
    ].filter(Boolean),
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <JsonLd data={personJsonLd} />
      <section className={styles.profile}>
        <p className={`fn-page-back ${styles.profileBack}`}>
          <Link href="/user">← クリエイター一覧</Link>
        </p>
        {profileIcon ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profileIcon} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarFb}>
            {profileName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className={styles.profileBody}>
          <h1 className={`fn-profile-name ${styles.name}`}>{profileName}</h1>
          <ProfileSocialLinks
            className={styles.socialLine}
            xUserId={user.id}
            youtubeChannelUrl={user.youtube_channel_url}
            socialLinks={socialLinks}
          />
        </div>
      </section>

      {user.profile_text || portfolioContact ? (
        <section className={styles.portfolioBlocks} aria-label="Portfolio">
          {user.profile_text ? (
            <article className={styles.portfolioBlock}>
              <span>About</span>
              <p>{user.profile_text}</p>
            </article>
          ) : null}
          {portfolioContact ? (
            <article className={styles.portfolioBlock}>
              <span>Contact</span>
              <p>{portfolioContact}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      <section className={styles.content} aria-labelledby="creator-works-heading">
        <h2 id="creator-works-heading" className={styles.sectionTitle}>
          作品
        </h2>

          {ownVideos.length === 0 ? (
            <div className="fn-empty">
              <Icon name="info" size={20} aria-hidden />
              <p className="fn-empty-message">
                まだ公開されている作品がありません。
              </p>
            </div>
          ) : (
            <>
              <div className="fn-video-grid">
                {ownVideos.map((v, index) => (
                  <div key={`${v.id}-own-${index}`} className={styles.workCard}>
                    <VideoCard video={v} />
                    {v.score > 0 ? (
                      <span className={styles.workScore}>{formatScore(v.score)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <Pagination
                currentPage={worksPaging.page}
                totalPages={ownTotalPages}
                total={ownTotal}
                pageSize={worksPaging.pageSize}
                buildHref={buildOwnHref}
                unitLabel="件"
              />
            </>
          )}

          {collabTotal > 0 ? (
            <section className={styles.subSection}>
              <h2 className={styles.subTitle}>参加作品</h2>
              <div className="fn-video-grid">
                {collabVideos.map((v, index) => (
                  <div key={`${v.id}-collab-${index}`} className={styles.workCard}>
                    <VideoCard video={v} />
                  </div>
                ))}
              </div>
              <Pagination
                currentPage={collabPaging.page}
                totalPages={collabTotalPages}
                total={collabTotal}
                pageSize={collabPaging.pageSize}
                buildHref={buildCollabHref}
                unitLabel="件"
              />
            </section>
          ) : null}
      </section>

    </div>
  );
}
