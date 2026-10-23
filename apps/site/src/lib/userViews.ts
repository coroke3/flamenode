/**
 * Pure view models for the public user routes (MIG-0504 / Recipe R-PAGE / Runtime S0).
 * Page counts, hrefs, ordering and texts come from CURRENT `app/(public)/user/**`; the data cores
 * (`staticUserProfileCore`, `staticUsersIndexCore`, `socialLinks`, `profileContact`) are imported from
 * CURRENT `src/` so the rules cannot drift while both sites exist. Phase 9 deletes `src/`: copy then.
 * Used at build time by the pages and in the browser by the paging / search Islands.
 */
import type { CreatorProfileData, CreatorsIndexEntry, CreatorsSort, ScreenVideoCard } from "@flamenode/ui";
import {
  STATIC_USER_COLLABS_PAGE_SIZE,
  STATIC_USER_MAX_PAGES,
  STATIC_USER_WORKS_PAGE_SIZE,
  type StaticUserProfile,
  type StaticUserVideoPage,
  type StaticUserVideoSection,
} from "../../../../src/lib/publicData/staticUserProfileCore.ts";
import {
  paginateUsersIndexItems,
  prepareUsersIndexItems,
  type StaticUsersIndexEntry,
} from "../../../../src/lib/publicData/staticUsersIndexCore.ts";
import { normalizePublicIconUrl } from "../../../../src/lib/publicData/publicIconProjection.ts";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";
import { formatSocialLinkLabel, parseSocialLinks, profileHeaderSocialLinks } from "../../../../src/lib/socialLinks.ts";
import { normalizePortfolioContact } from "../../../../src/lib/profileContact.ts";
import { totalPagesFor } from "../../../../src/lib/utils/sql.ts";
import type { VideoCardData } from "../../../../src/components/video/VideoCard.tsx";
import { absoluteUrl, buildPageHead, compactText, type PageHead } from "./pageHead.ts";

export const USER_WORKS_DISPLAY_PAGE_SIZE = 8;
export const USER_COLLAB_DISPLAY_PAGE_SIZE = 8;
/** CURRENT `USER_STATIC_DISPLAY_MAX_PAGES`: 5 artifact pages of 24 shown 8 at a time. */
export const USER_STATIC_DISPLAY_MAX_PAGES =
  STATIC_USER_MAX_PAGES * (STATIC_USER_WORKS_PAGE_SIZE / USER_WORKS_DISPLAY_PAGE_SIZE);
export const USERS_INDEX_PAGE_SIZE = 48;
export const PORTFOLIO_WORK_LIMIT = 36;

/** CURRENT `VideoCard`: link is the YouTube ID or the internal ID, thumbnail via the thumbnail API. */
export function toScreenVideoCard(video: VideoCardData): ScreenVideoCard {
  return {
    href: `/${video.youtube_video_id?.trim() || video.id}`,
    title: video.title,
    thumbnailUrl: youtubeThumbUrl(video.youtube_video_id, "mqdefault") || null,
    creatorName: video.display_name,
    creatorIconUrl: cachedGoogleImageUrl(video.icon_url),
    metaLabel: video.part ?? null,
  };
}

/**
 * CURRENT `projectVideoCardIcons` with the build's (empty) X icon map: the card icon is the stored
 * snapshot icon; no icon map is read, so no entry can override it.
 */
function projectCard(video: VideoCardData): VideoCardData {
  return { ...video, icon_url: normalizePublicIconUrl(video.icon_url) };
}

/** CURRENT `artifactPageForDisplay`. */
function artifactPageForDisplay(displayPage: number, displayPageSize: number, artifactPageSize: number): number {
  return Math.max(1, Math.ceil((displayPage * displayPageSize) / artifactPageSize));
}

export interface SectionPages {
  total: number;
  /** One entry per display page (1-based = index + 1); null when its artifact page was not published. */
  pages: (ScreenVideoCard[] | null)[];
}

/**
 * Every display page of a profile section the way CURRENT `UserProfilePage` slices them. Pages beyond
 * `USER_STATIC_DISPLAY_MAX_PAGES` do not exist (CURRENT answers 404); a page whose artifact object is
 * missing is null (CURRENT `missingPagedSection` -> 404).
 */
export function buildSectionPages(
  section: StaticUserVideoSection,
  extra: ReadonlyMap<number, StaticUserVideoPage>,
  displayPageSize: number,
  artifactPageSize: number,
): SectionPages {
  const totalPages = Math.min(totalPagesFor(section.total, displayPageSize), USER_STATIC_DISPLAY_MAX_PAGES);
  const pages: (ScreenVideoCard[] | null)[] = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const artifactPage = artifactPageForDisplay(page, displayPageSize, artifactPageSize);
    const items = artifactPage === 1 ? section.items : extra.get(artifactPage)?.items;
    if (!items) {
      pages.push(null);
      continue;
    }
    const localStart = (page - 1) * displayPageSize - (artifactPage - 1) * artifactPageSize;
    pages.push(items.slice(localStart, localStart + displayPageSize).map(projectCard).map(toScreenVideoCard));
  }
  return { total: section.total, pages };
}

/** Serializable profile header (everything except the paged sections), the props of the paging Island. */
export type CreatorHeader = Omit<CreatorProfileData, "works" | "collabs">;

export function buildCreatorHeader(profile: StaticUserProfile): CreatorHeader {
  const { user } = profile;
  const socialLinks = parseSocialLinks(user.other_social_links);
  return {
    id: user.id,
    name: user.x_name || user.id,
    iconUrl: cachedGoogleImageUrl(normalizePublicIconUrl(user.icon_url)),
    youtubeChannelUrl: user.youtube_channel_url,
    socialLinks: profileHeaderSocialLinks(socialLinks, user.id).map((link) => ({
      label: formatSocialLinkLabel(link.type, link.url),
      url: link.url,
    })),
    profileText: user.profile_text,
    contact: normalizePortfolioContact(user.portfolio_contact),
  };
}

/** CURRENT `buildOwnHref` / `buildCollabHref`: page 1 is the bare profile URL. */
export function profilePageHref(userId: string, key: "worksPage" | "collabPage", page: number): string {
  const basePath = `/user/${encodeURIComponent(userId)}`;
  if (page <= 1) return basePath;
  return `${basePath}?${new URLSearchParams({ [key]: String(page) }).toString()}`;
}

/** CURRENT `UserIndexView.params()`: the index query string; defaults are left out. */
export function usersIndexQuery(q: string, sort: CreatorsSort, page: number): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (sort && sort !== "score") p.set("sort", sort);
  if (page && String(page) !== "1") p.set("page", String(page));
  return p.toString();
}

export function parseUsersIndexSort(value: string | null | undefined): CreatorsSort {
  return value === "name" || value === "works" ? value : "score";
}

/** CURRENT `parsePageNumber`. */
export function parseIndexPage(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export interface UsersIndexView {
  creators: CreatorsIndexEntry[];
  total: number;
  totalPages: number;
  safePage: number;
}

/** CURRENT legacy-index path of `UserListPage`: filter, sort, paginate, then map to the card model. */
export function computeUsersIndexView(
  entries: readonly StaticUsersIndexEntry[],
  q: string,
  sort: CreatorsSort,
  page: number,
): UsersIndexView {
  const prepared = prepareUsersIndexItems(entries, q, sort);
  const paged = paginateUsersIndexItems(prepared, page, USERS_INDEX_PAGE_SIZE);
  return {
    creators: paged.current.map((entry) => ({
      id: entry.x_id,
      name: entry.x_name,
      iconUrl: cachedGoogleImageUrl(entry.icon_url),
      ownCount: entry.personal_count,
      collabCount: entry.collab_count,
      totalCount: entry.total_works,
    })),
    total: paged.total,
    totalPages: paged.totalPages,
    safePage: paged.safePage,
  };
}

/** CURRENT `generateMetadata` of `/user/[id]`. */
export function buildProfileHead(profile: StaticUserProfile): PageHead {
  const { user } = profile;
  return buildPageHead({
    title: `${user.x_name} - クリエイター`,
    description: user.profile_text ?? `FlameNodeで公開されている${user.x_name}の作品。`,
    path: `/user/${user.id}`,
    image: cachedGoogleImageUrl(normalizePublicIconUrl(user.icon_url)),
    ogType: "profile",
  });
}

/** CURRENT `generateMetadata` of `/user/[id]/portfolio` (always noindex). */
export function buildPortfolioHead(profile: StaticUserProfile): PageHead {
  const { user } = profile;
  const name = user.x_name || user.id;
  return buildPageHead({
    title: `${name} - Portfolio`,
    description: compactText(user.profile_text),
    path: `/user/${user.id}/portfolio`,
    image: cachedGoogleImageUrl(normalizePublicIconUrl(user.icon_url)),
    noIndex: true,
  });
}

/** CURRENT `UserListPage` metadata (`buildPageMetadata` of `/user`). */
export function buildUsersIndexHead(): PageHead {
  return buildPageHead({
    path: "/user",
    title: "クリエイターを見つける",
    description: "FlameNodeで作品を公開している映像クリエイターと参加作品を探せます。",
  });
}

/** CURRENT `profileJsonLd` of `StaticUserProfileView`, key for key. */
export function buildPersonJsonLd(profile: StaticUserProfile, origin?: string): Record<string, unknown> {
  const { user } = profile;
  const basePath = `/user/${encodeURIComponent(user.id)}`;
  const profileIcon = cachedGoogleImageUrl(normalizePublicIconUrl(user.icon_url));
  const profileName = user.x_name || user.id;
  const socialLinks = parseSocialLinks(user.other_social_links);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profileName,
    alternateName: `@${user.id}`,
    url: absoluteUrl(basePath, origin),
    image: profileIcon ? absoluteUrl(profileIcon, origin) : undefined,
    description: compactText(
      user.profile_text ?? `FlameNodeで公開されている${profileName}の作品とプロフィール。`,
    ),
    sameAs: [
      `https://x.com/${encodeURIComponent(user.id)}`,
      user.youtube_channel_url,
      ...socialLinks.map((link) => link.url),
    ].filter((url): url is string => Boolean(url?.startsWith("http"))),
  };
}

export { STATIC_USER_COLLABS_PAGE_SIZE, STATIC_USER_WORKS_PAGE_SIZE };
