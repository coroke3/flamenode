import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import { videos, xUsers } from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveXUserIcon } from "@/lib/db/xIconResolution";
import { buildPageMetadata, compactText } from "@/lib/seo";
import { formatUnix } from "@/lib/utils/format";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { parseSocialLinks } from "@/lib/socialLinks";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { countablePublicVideoCondition } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const WORK_LIMIT = 36;

interface Props {
  params: Promise<{ id: string }>;
}

interface PortfolioUser {
  id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  portfolio_contact: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
  creative_start_date: number | null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const data = await withDatabase(async (db) => {
    const row = (
      await db
        .select({
          x_name: xUsers.x_name,
          profile_text: xUsers.profile_text,
          icon_url: xUsers.icon_url,
        })
        .from(xUsers)
        .where(sql`lower(${xUsers.id}) = ${id}`)
        .limit(1)
    )[0];
    return row ?? null;
  });

  const name = data?.x_name || id;
  return buildPageMetadata({
    title: `${name} - Portfolio`,
    description:
      compactText(data?.profile_text) ??
      `FlameNodeで公開されている${name}のポートフォリオ。`,
    path: `/user/${id}/portfolio`,
    image: cachedGoogleImageUrl(data?.icon_url),
  });
}

export default async function PortfolioPage({
  params,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  if (!id) notFound();

  const bundle = await withDatabase(async (db) => {
    const userRow = (
      await db
        .select()
        .from(xUsers)
        .where(sql`lower(${xUsers.id}) = ${id}`)
        .limit(1)
    )[0];

    const publicOwnWhere = and(
      countablePublicVideoCondition,
      sql`lower(${videos.creator_x_user_id}) = ${id}`,
    )!;

    const fallbackUser = userRow
      ? null
      : (
          await db
            .select({
              id: sql<string>`${videos.creator_x_user_id}`,
              x_name: sql<string>`COALESCE(${videos.creator_display_name}, ${videos.creator_x_user_id})`,
              icon_url: videos.creator_icon_url,
              profile_text: sql<string | null>`NULL`,
              portfolio_contact: sql<string | null>`NULL`,
              youtube_channel_url: sql<string | null>`NULL`,
              other_social_links: sql<string | null>`NULL`,
              creative_start_date: sql<number | null>`NULL`,
            })
            .from(videos)
            .where(publicOwnWhere)
            .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
            .limit(1)
        )[0] ?? null;

    const user: PortfolioUser | null = userRow
      ? {
          id: userRow.id,
          x_name: userRow.x_name,
          icon_url: userRow.icon_url,
          profile_text: userRow.profile_text,
          portfolio_contact: userRow.portfolio_contact,
          youtube_channel_url: userRow.youtube_channel_url,
          other_social_links: userRow.other_social_links,
          creative_start_date: userRow.creative_start_date,
        }
      : fallbackUser;
    if (!user) return null;

    if (!user.icon_url) {
      user.icon_url = await resolveXUserIcon(db, user.id);
    }

    const works = (await db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.creator_display_name}, '@' || ${videos.creator_x_user_id})`,
        icon_url: sql<string | null>`COALESCE(${videos.creator_icon_url}, ${xUsers.icon_url})`,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
        part: videos.part,
      })
      .from(videos)
      .leftJoin(xUsers, sql`lower(${xUsers.id}) = lower(${videos.creator_x_user_id})`)
      .where(publicOwnWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(WORK_LIMIT)) as VideoCardData[];

    const countRow = (
      await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(videos)
        .where(publicOwnWhere)
        .limit(1)
    )[0];

    return {
      user,
      works,
      totalWorks: Number(countRow?.c ?? works.length),
    };
  });

  if (!bundle) notFound();

  const { user, works, totalWorks } = bundle;
  const name = user.x_name || user.id;
  const initial = name.trim().charAt(0).toUpperCase() || "F";
  const userIcon = cachedGoogleImageUrl(user.icon_url);
  const socialLinks = parseSocialLinks(user.other_social_links);
  const portfolioContact = normalizePortfolioContact(user.portfolio_contact);
  const hasProfile =
    user.profile_text ||
    portfolioContact ||
    user.youtube_channel_url ||
    socialLinks.length > 0;

  return (
    <main className={`fn-public-container fn-page ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.navLine}>
          <Link href={`/user/${user.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
            @{user.id} の公開プロフィール
          </Link>
          <Link href="/user" className={styles.closeLink} aria-label="一覧へ戻る">
            ×
          </Link>
        </div>

        <div className={styles.identity}>
          {userIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userIcon} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatarFallback}>{initial}</span>
          )}
          <div className={styles.identityBody}>
            <span className="fn-eyebrow">Portfolio</span>
            <h1 className={styles.name}>{name}</h1>
            <div className={styles.links}>
              <a href={`https://x.com/${user.id}`} target="_blank" rel="noreferrer">
                <Icon name="x" size={12} aria-hidden />
                @{user.id}
              </a>
              {user.youtube_channel_url ? (
                <a
                  href={user.youtube_channel_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="youtube" size={12} aria-hidden />
                  YouTube
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <dl className={styles.stats} aria-label="Portfolio stats">
          <div>
            <dt>Works</dt>
            <dd>{totalWorks.toLocaleString()}</dd>
          </div>
          {user.creative_start_date ? (
            <div>
              <dt>Since</dt>
              <dd>{formatUnix(user.creative_start_date, { dateOnly: true })}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {hasProfile ? (
        <section className={styles.profileGrid} aria-label="プロフィール">
          {user.profile_text ? (
            <article className={styles.profileBlock}>
              <span>About</span>
              <h2>自己紹介</h2>
              <p>{user.profile_text}</p>
            </article>
          ) : null}
          {portfolioContact || socialLinks.length > 0 ? (
            <article className={styles.profileBlock}>
              <span>Contact</span>
              <h2>連絡先</h2>
              {portfolioContact ? <p>{portfolioContact}</p> : null}
              {socialLinks.length > 0 ? (
                <ul className={styles.socialLinks}>
                  {socialLinks.map((link) => (
                    <li key={`${link.type}-${link.url}`}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.type}
                        <Icon name="external" size={11} aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}
        </section>
      ) : (
        <section className="fn-empty">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">
            このポートフォリオには、まだプロフィール項目が登録されていません。
          </p>
        </section>
      )}

      <section className={styles.works} aria-labelledby="portfolio-works-heading">
        <div className={styles.sectionHead}>
          <h2 id="portfolio-works-heading">Works</h2>
          {totalWorks > WORK_LIMIT ? (
            <Link href={`/user/${user.id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
              すべて見る
            </Link>
          ) : null}
        </div>
        {works.length > 0 ? (
          <div className={styles.grid}>
            {works.map((work) => (
              <VideoCard key={work.id} video={work} />
            ))}
          </div>
        ) : (
          <div className="fn-empty">
            <Icon name="grid" size={20} aria-hidden />
            <p className="fn-empty-message">
              まだ公開されている作品がありません。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
