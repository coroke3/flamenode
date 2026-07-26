import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "./page.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  VideoCard,
  type VideoCardData,
} from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, totalPagesFor } from "@/lib/utils/sql";
import { buildPageMetadata } from "@/lib/seo";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { parseSocialLinks } from "@/lib/socialLinks";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { ProfileSocialLinks } from "@/components/user/ProfileSocialLinks";
import {
  loadStaticUserCollabsPage,
  loadStaticUserWorksPage,
  loadStaticUserProfile,
  logPublicRequestMetrics,
  setPublicRequestRoute,
} from "@/lib/publicData/loader";
import type { StaticUserProfile, StaticUserVideoPage } from "@/lib/publicData/loader";
import { STATIC_USER_MAX_PAGES } from "@/lib/publicData/staticUserProfileCore";
import {
  loadPublicXIconMapOptional,
} from "@/lib/publicData/staticSharedInputsLoader";
import {
  publicXIconEntriesToMap,
  resolveProjectedIcon,
  type PublicXIconEntry,
} from "@/lib/publicData/publicIconProjection";

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
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const staticLoaded = await loadStaticUserProfile(id);
  if (staticLoaded.data) {
    const { user } = staticLoaded.data;
    return buildPageMetadata({
      title: `${user.x_name} - クリエイター`,
      description:
        user.profile_text ??
        `FlameNodeで公開されている${user.x_name}の作品。`,
      path: `/user/${id}`,
      image: cachedGoogleImageUrl(user.icon_url),
      ogType: "profile",
    });
  }
  return { title: id };
}

export default async function UserPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  const sp = (await searchParams) ?? {};
  setPublicRequestRoute(`/user/${id}`);
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
    const staticLoaded = await loadStaticUserProfile(id);
    if (staticLoaded.data) {
      const [worksLoaded, collabsLoaded] = await Promise.all([
        worksPaging.page > 1
          ? loadStaticUserWorksPage({
              userId: id,
              page: worksPaging.page,
              profile: staticLoaded.data,
              strategy: staticLoaded.strategy,
            })
          : Promise.resolve({
              page: {
                page: 1,
                total: staticLoaded.data.works.total,
                items: staticLoaded.data.works.items,
                pageSize: staticLoaded.data.works.pageSize,
                generatedAt: staticLoaded.data.generatedAt,
              } satisfies StaticUserVideoPage,
            }),
        collabPaging.page > 1
          ? loadStaticUserCollabsPage({
              userId: id,
              page: collabPaging.page,
              profile: staticLoaded.data,
              strategy: staticLoaded.strategy,
            })
          : Promise.resolve({
              page: {
                page: 1,
                total: staticLoaded.data.collabs.total,
                items: staticLoaded.data.collabs.items,
                pageSize: staticLoaded.data.collabs.pageSize,
                generatedAt: staticLoaded.data.generatedAt,
              } satisfies StaticUserVideoPage,
            }),
      ]);
      const beyondStaticPages =
      worksPaging.page > STATIC_USER_MAX_PAGES ||
      collabPaging.page > STATIC_USER_MAX_PAGES;
    const missingPagedSection =
      (worksPaging.page > 1 && !worksLoaded.page) ||
      (collabPaging.page > 1 && !collabsLoaded.page);
    if (beyondStaticPages || missingPagedSection) {
      notFound();
    }
    const worksPage =
          worksLoaded.page ??
          ({
            page: 1,
            total: staticLoaded.data.works.total,
            items: staticLoaded.data.works.items,
            pageSize: staticLoaded.data.works.pageSize,
            generatedAt: staticLoaded.data.generatedAt,
          } satisfies StaticUserVideoPage);
        const collabPage =
          collabsLoaded.page ??
          ({
            page: 1,
            total: staticLoaded.data.collabs.total,
            items: staticLoaded.data.collabs.items,
            pageSize: staticLoaded.data.collabs.pageSize,
            generatedAt: staticLoaded.data.generatedAt,
          } satisfies StaticUserVideoPage);

        const visibleVideoCards = [
          ...worksPage.items,
          ...collabPage.items,
        ];
        const needsIconMap = visibleVideoCards.some(
          (video) => Boolean(video.creator_x_user_id),
        );
        const iconMapPayload = needsIconMap
          ? await loadPublicXIconMapOptional()
          : null;
        const iconMap =
          publicXIconEntriesToMap(iconMapPayload);

        const view = (
          <StaticUserProfileView
            profile={staticLoaded.data}
            worksPage={worksPage}
            collabPage={collabPage}
            worksPageNum={Math.min(worksPaging.page, STATIC_USER_MAX_PAGES)}
            collabPageNum={Math.min(collabPaging.page, STATIC_USER_MAX_PAGES)}
            iconMap={iconMap}
          />
        );
        logPublicRequestMetrics();
        return view;
  }
  notFound();
}

function StaticUserProfileView({
  profile,
  worksPage,
  collabPage,
  worksPageNum,
  collabPageNum,
  iconMap,
}: {
  profile: StaticUserProfile;
  worksPage: StaticUserVideoPage | null;
  collabPage: StaticUserVideoPage | null;
  worksPageNum: number;
  collabPageNum: number;
  iconMap: ReadonlyMap<string, PublicXIconEntry>;
}): React.ReactElement {
  const { user } = profile;
  const ownVideos = projectVideoCardIcons(
    worksPage?.items ?? [],
    iconMap,
  );
  const ownTotal = worksPage?.total ?? profile.works.total;
  const collabVideos = projectVideoCardIcons(
    collabPage?.items ?? [],
    iconMap,
  );
  const collabTotal = collabPage?.total ?? profile.collabs.total;
  const ownTotalPages = Math.min(
    totalPagesFor(ownTotal, WORKS_PAGE_SIZE),
    STATIC_USER_MAX_PAGES,
  );
  const collabTotalPages = Math.min(
    totalPagesFor(collabTotal, COLLAB_PAGE_SIZE),
    STATIC_USER_MAX_PAGES,
  );
  const pageNum = Math.min(
    Math.max(1, Math.floor(worksPageNum)),
    Math.max(1, ownTotalPages),
  );
  const collabPageResolved = Math.min(
    Math.max(1, Math.floor(collabPageNum)),
    Math.max(1, collabTotalPages),
  );
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

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
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
                <div key={`${v.id}-static-own-${index}`} className={styles.workCard}>
                  <VideoCard video={v} />
                </div>
              ))}
            </div>
            <Pagination
              currentPage={pageNum}
              totalPages={ownTotalPages}
              total={ownTotal}
              pageSize={WORKS_PAGE_SIZE}
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
                <div key={`${v.id}-static-collab-${index}`} className={styles.workCard}>
                  <VideoCard video={v} />
                </div>
              ))}
            </div>
            <Pagination
              currentPage={collabPageResolved}
              totalPages={collabTotalPages}
              total={collabTotal}
              pageSize={COLLAB_PAGE_SIZE}
              buildHref={buildCollabHref}
              unitLabel="件"
            />
          </section>
        ) : null}
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
