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
import {
  absoluteUrl,
  buildPageMetadata,
  compactText,
} from "@/lib/seo";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { parseSocialLinks } from "@/lib/socialLinks";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { ProfileSocialLinks } from "@/components/user/ProfileSocialLinks";
import { UserAvatar } from "@/components/user/UserAvatar";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  loadStaticUserCollabsPage,
  loadStaticUserWorksPage,
  loadStaticUserProfile,
  logPublicRequestMetrics,
  PublicDataUnavailableNotice,
  PublicReflectionPendingNotice,
  setPublicRequestRoute,
  shouldPublicPageNotFound,
  shouldPublicPageShowReflection,
  shouldPublicPageShowUnavailable,
} from "@/lib/publicData/loader";
import type { StaticUserProfile, StaticUserVideoPage } from "@/lib/publicData/loader";
import {
  STATIC_USER_COLLABS_PAGE_SIZE,
  STATIC_USER_MAX_PAGES,
  STATIC_USER_WORKS_PAGE_SIZE,
} from "@/lib/publicData/staticUserProfileCore";
import {
  normalizePublicIconUrl,
  resolveProjectedIcon,
  type PublicXIconEntry,
} from "@/lib/publicData/publicIconProjection";

export const revalidate = 30;

const WORKS_PAGE_SIZE = 8;
const COLLAB_PAGE_SIZE = 8;
const USER_STATIC_DISPLAY_MAX_PAGES =
  STATIC_USER_MAX_PAGES * (STATIC_USER_WORKS_PAGE_SIZE / WORKS_PAGE_SIZE);

function artifactPageForDisplay(
  displayPage: number,
  displayPageSize: number,
  artifactPageSize: number,
): number {
  return Math.max(
    1,
    Math.ceil((displayPage * displayPageSize) / artifactPageSize),
  );
}

function sliceDisplayItems<T>(
  items: readonly T[],
  displayPage: number,
  displayPageSize: number,
  artifactPageSize: number,
): T[] {
  const artifactPage = artifactPageForDisplay(
    displayPage,
    displayPageSize,
    artifactPageSize,
  );
  const localStart =
    (displayPage - 1) * displayPageSize -
    (artifactPage - 1) * artifactPageSize;
  return items.slice(localStart, localStart + displayPageSize);
}

function clampDisplayPage(
  requestedPage: number,
  totalItems: number,
  displayPageSize: number,
  maxPages: number,
): number {
  const totalPages = Math.min(
    totalPagesFor(totalItems, displayPageSize),
    maxPages,
  );
  return Math.min(Math.max(1, requestedPage), Math.max(1, totalPages));
}

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
    const metadataIcon =
      normalizePublicIconUrl(user.icon_url) ??
      resolveProjectedIcon({
        xUserId: user.id,
        iconMap: new Map(),
        legacyIconUrl: null,
      });
    return buildPageMetadata({
      title: `${user.x_name} - クリエイター`,
      description:
        user.profile_text ??
        `FlameNodeで公開されている${user.x_name}の作品。`,
      path: `/user/${id}`,
      image: cachedGoogleImageUrl(metadataIcon),
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
    const worksArtifactPage = artifactPageForDisplay(
      worksPaging.page,
      WORKS_PAGE_SIZE,
      STATIC_USER_WORKS_PAGE_SIZE,
    );
    const collabArtifactPage = artifactPageForDisplay(
      collabPaging.page,
      COLLAB_PAGE_SIZE,
      STATIC_USER_COLLABS_PAGE_SIZE,
    );
    const staticLoaded = await loadStaticUserProfile(id);
    if (staticLoaded.data) {
      const [worksLoaded, collabsLoaded] = await Promise.all([
        worksArtifactPage > 1
          ? loadStaticUserWorksPage({
              userId: id,
              page: worksArtifactPage,
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
              state: "ready" as const,
            }),
        collabArtifactPage > 1
          ? loadStaticUserCollabsPage({
              userId: id,
              page: collabArtifactPage,
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
              state: "ready" as const,
            }),
      ]);
      const beyondStaticPages =
      worksArtifactPage > STATIC_USER_MAX_PAGES ||
      collabArtifactPage > STATIC_USER_MAX_PAGES;
    const missingPagedSection =
      (worksArtifactPage > 1 && !worksLoaded.page) ||
      (collabArtifactPage > 1 && !collabsLoaded.page);
    const unavailablePagedSection =
      (worksArtifactPage > 1 &&
        (worksLoaded.state === "unavailable" || worksLoaded.state === "reflecting")) ||
      (collabArtifactPage > 1 &&
        (collabsLoaded.state === "unavailable" || collabsLoaded.state === "reflecting"));
    if (unavailablePagedSection) {
      return worksLoaded.state === "reflecting" || collabsLoaded.state === "reflecting"
        ? <PublicReflectionPendingNotice />
        : <PublicDataUnavailableNotice />;
    }
    if (beyondStaticPages || missingPagedSection) {
      notFound();
    }
    const worksTotalPages = Math.min(
      totalPagesFor(staticLoaded.data.works.total, WORKS_PAGE_SIZE),
      USER_STATIC_DISPLAY_MAX_PAGES,
    );
    const collabTotalPages = Math.min(
      totalPagesFor(staticLoaded.data.collabs.total, COLLAB_PAGE_SIZE),
      USER_STATIC_DISPLAY_MAX_PAGES,
    );
    if (
      worksPaging.page > worksTotalPages ||
      collabPaging.page > collabTotalPages
    ) {
      notFound();
    }
    const worksPageRaw =
          worksLoaded.page ??
          ({
            page: 1,
            total: staticLoaded.data.works.total,
            items: staticLoaded.data.works.items,
            pageSize: staticLoaded.data.works.pageSize,
            generatedAt: staticLoaded.data.generatedAt,
          } satisfies StaticUserVideoPage);
        const collabPageRaw =
          collabsLoaded.page ??
          ({
            page: 1,
            total: staticLoaded.data.collabs.total,
            items: staticLoaded.data.collabs.items,
            pageSize: staticLoaded.data.collabs.pageSize,
            generatedAt: staticLoaded.data.generatedAt,
          } satisfies StaticUserVideoPage);
        const worksPage = {
          ...worksPageRaw,
          items: sliceDisplayItems(
            worksPageRaw.items,
            worksPaging.page,
            WORKS_PAGE_SIZE,
            STATIC_USER_WORKS_PAGE_SIZE,
          ),
          pageSize: WORKS_PAGE_SIZE,
        };
        const collabPage = {
          ...collabPageRaw,
          items: sliceDisplayItems(
            collabPageRaw.items,
            collabPaging.page,
            COLLAB_PAGE_SIZE,
            STATIC_USER_COLLABS_PAGE_SIZE,
          ),
          pageSize: COLLAB_PAGE_SIZE,
        };

        const iconMap = new Map<string, PublicXIconEntry>();

        const view = (
          <StaticUserProfileView
            profile={staticLoaded.data}
            worksPage={worksPage}
            collabPage={collabPage}
            worksPageNum={Math.min(worksPaging.page, USER_STATIC_DISPLAY_MAX_PAGES)}
            collabPageNum={Math.min(collabPaging.page, USER_STATIC_DISPLAY_MAX_PAGES)}
            iconMap={iconMap}
          />
        );
        logPublicRequestMetrics();
        return view;
  }
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
    USER_STATIC_DISPLAY_MAX_PAGES,
  );
  const collabTotalPages = Math.min(
    totalPagesFor(collabTotal, COLLAB_PAGE_SIZE),
    USER_STATIC_DISPLAY_MAX_PAGES,
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
  const profileIcon = cachedGoogleImageUrl(
    normalizePublicIconUrl(user.icon_url) ??
      resolveProjectedIcon({ xUserId: user.id, iconMap, legacyIconUrl: null }),
  );
  const profileName = user.x_name || user.id;
  const socialLinks = parseSocialLinks(user.other_social_links);
  const portfolioContact = normalizePortfolioContact(user.portfolio_contact);
  const profileDescription = compactText(
    user.profile_text ??
      `FlameNodeで公開されている${profileName}の作品とプロフィール。`,
  );
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profileName,
    alternateName: `@${user.id}`,
    url: absoluteUrl(basePath),
    image: profileIcon ? absoluteUrl(profileIcon) : undefined,
    description: profileDescription,
    sameAs: [
      `https://x.com/${encodeURIComponent(user.id)}`,
      user.youtube_channel_url,
      ...socialLinks.map((link) => link.url),
    ].filter((url): url is string => Boolean(url?.startsWith("http"))),
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <JsonLd data={profileJsonLd} />
      <section className={styles.profile}>
        <p className={`fn-page-back ${styles.profileBack}`}>
          <Link href="/user">← クリエイター一覧</Link>
        </p>
        <UserAvatar
          iconUrl={profileIcon}
          label={profileName}
          className={styles.avatar}
          imageClassName={styles.avatar}
          fallbackClassName={styles.avatarFb}
          useIconFallback
        />
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
    // 作品カードは投稿・作品保存時のsnapshotを正本にする。snapshotが無い場合だけ
    // 現在のXプロフィールアイコンへfallbackする。プロフィールヘッダーは従来通り
    // current profile iconを優先するため、作品単位の見た目だけを修正する。
    icon_url:
      normalizePublicIconUrl(video.icon_url) ??
      resolveProjectedIcon({
        xUserId: video.creator_x_user_id,
        iconMap,
        legacyIconUrl: null,
      }),
  }));
}
