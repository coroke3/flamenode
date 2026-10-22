/**
 * Public snapshot -> page `<head>` and shared screen props for the three public
 * detail pages (MIG-0403, Recipe R-PAGE, Runtime S0). Each rule names the
 * CURRENT line it follows. Lists, totals and live values (members, chapters,
 * related works, event works/staff/slots, creator works, likes) are not in the
 * snapshot yet: the pages render the screens' empty states for them, and the
 * owner tasks are recorded in docs/migration/work-items/MIG-0403.md.
 *
 * Kept free of Astro so the MIG-0411 queue renderer can use the same mapping.
 */
import type { CreatorProfileData, EventDetailData, VideoDetailData } from "@flamenode/ui";
import { buildPageMetadata, type PageMetadata } from "./pageMetadata.ts";
import type { EventPublicSnapshot, UserPublicSnapshot, VideoPublicSnapshot } from "./publicDataLoader.ts";

/** CURRENT `UserProfilePage.tsx` WORKS_PAGE_SIZE / COLLAB_PAGE_SIZE. */
const CREATOR_PAGE_SIZE = 8;

/** CURRENT `formatUnix(..., { dateOnly: true })` (`src/lib/utils/format.ts`). */
const dateOnlyJst = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** CURRENT `youtubeThumbUrl` (`src/lib/youtube/id.ts`): same-site thumbnail proxy. */
function youtubeThumbPath(youtubeVideoId: string, size: "hqdefault" | "maxresdefault"): string {
  return `/api/youtube-thumbnail/${youtubeVideoId}/${size}`;
}

/** CURRENT `/[id]` serves the internal ID and the YouTube ID alias (UX-VID-001/002). */
export function videoPaths(video: VideoPublicSnapshot): string[] {
  return video.youtubeVideoId && video.youtubeVideoId !== video.id ? [video.id, video.youtubeVideoId] : [video.id];
}

/** CURRENT `app/(public)/[id]/page.tsx` generateMetadata. */
export function videoMetadata(video: VideoPublicSnapshot): PageMetadata {
  const description =
    video.introComment ||
    video.highlights ||
    [video.music ? `使用楽曲: ${video.music}` : null, video.credit ? `クレジット: ${video.credit}` : null]
      .filter(Boolean)
      .join(" / ");
  return buildPageMetadata({
    title: `${video.title} - ${video.creatorName ?? "unknown"}`,
    description,
    // Canonical is the YouTube ID path when there is one, for both URLs.
    path: `/${video.youtubeVideoId ?? video.id}`,
    image: video.youtubeVideoId ? youtubeThumbPath(video.youtubeVideoId, "maxresdefault") : video.creatorIconUrl,
    ogType: "video.other",
  });
}

/** CURRENT `StaticVideoDetailView` author block and player poster. */
export function videoScreenData(video: VideoPublicSnapshot): VideoDetailData {
  const xUserId = video.creatorXUserId ?? null;
  return {
    id: video.id,
    title: video.title,
    creator: {
      name: video.creatorName?.trim() || "作者未設定",
      xUserId,
      iconUrl: video.creatorIconUrl ?? null,
      profileHref: xUserId && video.creatorHasPublicProfile ? `/user/${xUserId}` : null,
      youtubeChannelUrl: video.creatorYoutubeChannelUrl ?? null,
    },
    publishedLabel: video.scheduledTime ? dateOnlyJst.format(new Date(video.scheduledTime * 1000)) : null,
    thumbnailUrl: video.youtubeVideoId ? youtubeThumbPath(video.youtubeVideoId, "hqdefault") : null,
    hasYoutube: Boolean(video.youtubeVideoId),
    music: video.music ?? null,
    credit: video.credit ?? null,
    introComment: video.introComment ?? null,
    highlights: video.highlights ?? null,
  };
}

/** CURRENT `app/(public)/event/[id]/page.tsx` generateMetadata. */
export function eventMetadata(event: EventPublicSnapshot): PageMetadata {
  return buildPageMetadata({
    title: event.title,
    description: event.explanation,
    path: `/event/${event.id}`,
    image: event.imageUrl ?? event.iconUrl,
  });
}

export function eventScreenData(event: EventPublicSnapshot): EventDetailData {
  return {
    id: event.id,
    title: event.title,
    imageUrl: event.imageUrl ?? event.iconUrl ?? null,
    iconUrl: event.iconUrl ?? null,
    explanation: event.explanation ?? null,
    // Build-time CURRENT label (`app/(public)/event/[id]/page.tsx:234-236`). Without one the view
    // shows no pill: the snapshot has no dates to tell open / ended, and never the Badge DRAFT default.
    statusLabel: event.statusLabel ?? "",
    // The CURRENT pill has one accent style for every status (never the muted draft tone).
    statusTone: "public",
    periodLabel: event.periodLabel ?? null,
    entryAction: event.entryAction ?? null,
    // Totals and slot counts come from lists / the live slots API (MIG-0502).
    videoTotal: 0,
    creatorTotal: 0,
    slotFilled: 0,
    slotTotal: 0,
  };
}

/** CURRENT `app/(public)/user/[id]/UserProfilePage.tsx` generateMetadata. */
export function creatorMetadata(user: UserPublicSnapshot): PageMetadata {
  const name = user.name ?? user.title;
  return buildPageMetadata({
    title: `${name} - クリエイター`,
    description: user.profileText ?? `FlameNodeで公開されている${name}の作品。`,
    path: `/user/${user.id}`,
    image: user.iconUrl,
    ogType: "profile",
  });
}

/** CURRENT `StaticUserProfileView`: page 1 is the bare profile URL, else `?worksPage=` / `?collabPage=`. */
export function creatorScreenData(user: UserPublicSnapshot): CreatorProfileData {
  const basePath = `/user/${encodeURIComponent(user.id)}`;
  const pageHref = (param: "worksPage" | "collabPage") => (page: number) =>
    page <= 1 ? basePath : `${basePath}?${new URLSearchParams({ [param]: String(page) })}`;
  const emptyPage = (param: "worksPage" | "collabPage") => ({
    items: [],
    total: 0,
    currentPage: 1,
    totalPages: 1,
    pageSize: CREATOR_PAGE_SIZE,
    buildHref: pageHref(param),
  });
  return {
    id: user.id,
    name: user.name || user.id,
    iconUrl: user.iconUrl ?? null,
    youtubeChannelUrl: user.youtubeChannelUrl ?? null,
    profileText: user.profileText ?? null,
    works: emptyPage("worksPage"),
    collabs: emptyPage("collabPage"),
  };
}
