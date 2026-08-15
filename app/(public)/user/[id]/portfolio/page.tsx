import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "./page.module.css";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";
import { buildPageMetadata, compactText } from "@/lib/seo";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { parseSocialLinks } from "@/lib/socialLinks";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { ProfileSocialLinks } from "@/components/user/ProfileSocialLinks";
import { UserAvatar } from "@/components/user/UserAvatar";
import {
  loadStaticUserProfile,
  PublicDataUnavailableNotice,
  PublicReflectionPendingNotice,
  shouldPublicPageNotFound,
  shouldPublicPageShowReflection,
  shouldPublicPageShowUnavailable,
} from "@/lib/publicData/loader";
import { loadPublicXIconMapOptional } from "@/lib/publicData/staticSharedInputsLoader";
import {
  publicXIconEntriesToMap,
  normalizePublicIconUrl,
  resolveProjectedIcon,
  type PublicXIconEntry,
} from "@/lib/publicData/publicIconProjection";

export const dynamic = "force-dynamic";

const WORK_LIMIT = 36;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const [staticLoaded, iconMapPayload] = await Promise.all([
    loadStaticUserProfile(id),
    loadPublicXIconMapOptional([id]),
  ]);
  const user = staticLoaded.data?.user;
  const name = user?.x_name || id;
  const iconMap = publicXIconEntriesToMap(iconMapPayload);
  const metadataIcon =
    normalizePublicIconUrl(user?.icon_url) ??
    resolveProjectedIcon({
      xUserId: user?.id ?? id,
      iconMap,
      legacyIconUrl: null,
    });
  return buildPageMetadata({
    title: `${name} - Portfolio`,
    description:
      compactText(user?.profile_text) ??
      `FlameNodeで公開されている${name}のポートフォリオ。`,
    path: `/user/${id}/portfolio`,
    image: cachedGoogleImageUrl(metadataIcon),
    noIndex: true,
  });
}

export default async function PortfolioPage({
  params,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  if (!id) notFound();

  const [staticLoaded, iconMapPayload] = await Promise.all([
    loadStaticUserProfile(id),
    loadPublicXIconMapOptional([id]),
  ]);
  if (!staticLoaded.data) {
    if (shouldPublicPageShowReflection(staticLoaded.state)) {
      return <PublicReflectionPendingNotice />;
    }
    if (shouldPublicPageShowUnavailable(staticLoaded.state)) {
      return <PublicDataUnavailableNotice />;
    }
    if (shouldPublicPageNotFound(staticLoaded.state)) {
      notFound();
    }
    notFound();
  }

  const user = staticLoaded.data.user;
  const iconMap = publicXIconEntriesToMap(iconMapPayload);
  const works = projectVideoCardIcons(
    staticLoaded.data.works.items.slice(0, WORK_LIMIT),
    iconMap,
  );
  const totalWorks = staticLoaded.data.works.total;
  const name = user.x_name || user.id;
  const userIcon = cachedGoogleImageUrl(
    normalizePublicIconUrl(user.icon_url) ??
      resolveProjectedIcon({ xUserId: user.id, iconMap, legacyIconUrl: null }),
  );
  const socialLinks = parseSocialLinks(user.other_social_links);
  const portfolioContact = normalizePortfolioContact(user.portfolio_contact);
  const hasProfile = user.profile_text || portfolioContact;

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
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
          <UserAvatar
            iconUrl={userIcon}
            label={name}
            className={styles.avatar}
            imageClassName={styles.avatar}
            fallbackClassName={styles.avatarFallback}
            useIconFallback
          />
          <div className={styles.identityBody}>
            <span className="fn-eyebrow">Portfolio</span>
            <h1 className={styles.name}>{name}</h1>
            <ProfileSocialLinks
              className={styles.links}
              xUserId={user.id}
              youtubeChannelUrl={user.youtube_channel_url}
              socialLinks={socialLinks}
            />
          </div>
        </div>

        <dl className={styles.stats} aria-label="Portfolio stats">
          <div>
            <dt>Works</dt>
            <dd>{totalWorks.toLocaleString()}</dd>
          </div>
        </dl>
      </header>

      {hasProfile ? (
        <section className={styles.profileGrid} aria-label="プロフィール">
          {user.profile_text ? (
            <article className={styles.profileBlock}>
              <span>About</span>
              <p>{user.profile_text}</p>
            </article>
          ) : null}
          {portfolioContact ? (
            <article className={styles.profileBlock}>
              <span>Contact</span>
              <p>{portfolioContact}</p>
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
    </div>
  );
}

function projectVideoCardIcons(
  videos: readonly VideoCardData[],
  iconMap: ReadonlyMap<string, PublicXIconEntry>,
): VideoCardData[] {
  return videos.map((video) => ({
    ...video,
    icon_url: resolveProjectedIcon({
      xUserId: video.creator_x_user_id,
      iconMap,
      legacyIconUrl: video.icon_url,
    }),
  }));
}
