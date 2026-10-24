/**
 * Build-time `/[id]` pages (MIG-0507 U01/U02/U05). One verified `video-detail` snapshot per public video
 * (CURRENT `videos/{id}.json` artifact) is projected with CURRENT's pure code: `normalizeStaticVideoDetail`,
 * `buildPublicVideoViewModelFromStatic`, `computeEventStatus`, `compactText` rules and the page's JSON-LD.
 * Root slugs are checked with the MIG-0404 route map, so a video id can never shadow a fixed route or asset.
 * No snapshot configured = the fixture videos (videoFixtures.ts), like events and users. A partly configured env
 * or a configured but broken snapshot (including a non-public or missing object the manifest allows) fails the build.
 */
import type { VideoDetailData } from "@flamenode/ui";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { buildPublicVideoViewModelFromStatic } from "../../../../src/lib/publicData/publicVideoDetailViewModel.ts";
import { normalizeStaticVideoDetail } from "../../../../src/lib/publicData/staticVideoDetailCore.ts";
import { computeEventStatus, eventStatusLabel, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";
import { formatChapterTime } from "../../../../src/lib/utils/chapterTime.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import { extractYoutubeId, youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";
import { buildRouteMap } from "./routeMap.ts";
import { buildPageHead, compactText, siteOrigin, type PageHead } from "./pageHead.ts";
import { loadVideoDetailPayload, videoDetailKeys } from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "./videoFixtures.ts";

export class VideoPageBuildError extends Error {
  readonly code = "VIDEO_DETAIL_INVALID";
  constructor(key: string) {
    super(`Video snapshot ${key} is missing, not public, or not in the CURRENT artifact shape`);
    this.name = "VideoPageBuildError";
  }
}

export type VideoPage = Readonly<{
  slug: string;
  /** The page a YouTube-id URL and an internal-id URL both point their canonical at. */
  canonicalSlug: string;
  head: PageHead;
  jsonLd: readonly unknown[];
  data: VideoDetailData;
  videoId: string;
  youtubeId: string | null;
}>;

const TONE = { active: "public", published: "public", scheduled: "warning", ended: "draft", private: "draft" } as const;

export function buildVideoPages(payload: unknown, key: string, now: number = Math.floor(Date.now() / 1000)): VideoPage[] {
  const detail = normalizeStaticVideoDetail((payload ?? {}) as Parameters<typeof normalizeStaticVideoDetail>[0]);
  if (!detail || detail.video.visibility_status !== "public") throw new VideoPageBuildError(key);
  const vm = buildPublicVideoViewModelFromStatic(detail);
  const { video } = vm;
  const youtubeVideoId = video.youtube_video_id?.trim() || null;
  const youtubeId = extractYoutubeId(youtubeVideoId);
  const canonicalSlug = youtubeVideoId ?? video.id;
  const creatorId = video.creator_x_user_id ?? "anonymous";
  const creatorName = video.creator_display_name?.trim() || "作者未設定";
  const creatorHref = creatorId !== "anonymous" && (video.creator_has_public_profile ?? false) ? `/user/${creatorId}` : null;
  const primary = vm.primaryEvent;
  const primaryStatus = primary ? computeEventStatus(primary, now) : null;

  const memberName = new Map(vm.publicMembers.map((m) => [m.id, m.display_name]));
  const chapters = [
    ...vm.memberChapters.map((c) => ({ id: c.id, t: c.chapter_time, label: c.chapter_label, author: memberName.get(c.video_member_id) ?? null, kind: "member" as const })),
    ...vm.publicChapters.map((c) => ({ id: c.id, t: c.chapter_time, label: c.chapter_label, author: c.author_name, kind: "comment" as const })),
  ].sort((a, b) => a.t - b.t);

  const data: VideoDetailData = {
    id: video.id,
    title: video.title,
    creator: {
      name: creatorName,
      xUserId: creatorId !== "anonymous" ? creatorId : null,
      iconUrl: cachedGoogleImageUrl(video.creator_icon_url),
      profileHref: creatorHref,
      youtubeChannelUrl: video.creator_youtube_channel_url ?? null,
    },
    publishedLabel: video.scheduled_time ? formatUnix(video.scheduled_time, { dateOnly: true }) : null,
    thumbnailUrl: youtubeId ? youtubeThumbUrl(youtubeId, "maxresdefault") : null,
    hasYoutube: Boolean(youtubeId),
    music: video.music,
    credit: video.credit,
    musicReferenceUrl: video.music_reference_url,
    introComment: video.intro_comment,
    softwareLabel: vm.softwareLabel,
    highlights: video.highlights,
    productionStory: video.production_story,
    closingComment: video.closing_comment,
    primaryEvent: primary
      ? {
          id: primary.id,
          title: primary.title,
          iconUrl: cachedGoogleImageUrl(primary.icon_url),
          statusLabel: eventStatusLabel(primaryStatus!),
          statusTone: TONE[primaryStatus!],
          accepting: isAcceptingEntries(primary, now),
          playlistUrl: null,
        }
      : null,
    otherEvents: vm.publicEvents.filter((e) => e.id !== primary?.id).map((e) => ({ id: e.id, title: e.title })),
    members: vm.publicMembers.map((m) => ({
      id: m.id,
      name: m.display_name,
      xUserId: m.x_user_id,
      iconUrl: cachedGoogleImageUrl(m.icon_url ?? null),
      role: m.role_label,
      comment: m.comment ?? null,
      profileHref: m.x_user_id && (m.has_public_profile ?? false) ? `/user/${m.x_user_id}` : null,
      chapterTimes: vm.memberChapters.filter((c) => c.video_member_id === m.id).map((c) => formatChapterTime(c.chapter_time)),
    })),
    chapters: chapters.map((c) => ({ id: c.id, timeLabel: formatChapterTime(c.t), label: c.label, authorName: c.author, kind: c.kind })),
    related: vm.relatedVideos.map((r) => ({
      href: `/${r.youtube_video_id?.trim() || r.id}`,
      title: r.title,
      creatorName: r.display_name,
      thumbnailUrl: youtubeThumbUrl(r.youtube_video_id, "mqdefault") || null,
    })),
    likeCount: vm.appLikeCount,
  };

  // CURRENT `generateMetadata` and `videoJsonLd` of app/(public)/[id]/page.tsx.
  const description = compactText(
    video.intro_comment || video.highlights || [video.music ? `使用楽曲: ${video.music}` : null, video.credit ? `クレジット: ${video.credit}` : null].filter(Boolean).join(" / "),
  );
  const origin = siteOrigin();
  const absolute = (path: string): string => new URL(path, origin).toString();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: video.title,
      description: compactText(video.intro_comment || video.highlights || video.production_story || video.closing_comment || (video.music ? `使用楽曲: ${video.music}` : null)),
      url: absolute(`/${canonicalSlug}`),
      thumbnailUrl: youtubeId ? [absolute(youtubeThumbUrl(youtubeId, "maxresdefault"))] : undefined,
      uploadDate: video.scheduled_time ? new Date(video.scheduled_time * 1000).toISOString() : undefined,
      embedUrl: youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : undefined,
      contentUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined,
      author: { "@type": "Person", name: creatorName, url: creatorHref ? absolute(creatorHref) : undefined },
    },
  ];
  const head = buildPageHead({
    path: `/${canonicalSlug}`,
    title: `${video.title} - ${video.creator_display_name ?? "unknown"}`,
    description,
    image: youtubeId ? youtubeThumbUrl(youtubeId, "maxresdefault") : video.creator_icon_url,
    ogType: "video.other",
  });
  const page = { canonicalSlug, head, jsonLd, data, videoId: video.id, youtubeId };
  // CURRENT answers both the YouTube-id URL and the internal-id URL with the same page; canonical is the first.
  return [{ ...page, slug: canonicalSlug }, ...(canonicalSlug !== video.id ? [{ ...page, slug: video.id }] : [])];
}

export async function loadVideoPagesForBuild(
  env: Record<string, string | undefined> = process.env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VideoPage[]> {
  const access = snapshotAccessFromEnv(env);
  const pages: VideoPage[] = [];
  if (!access) {
    for (const [id, p] of Object.entries(FIXTURE_VIDEO_DETAIL_PAYLOADS)) pages.push(...buildVideoPages(p, `fixture:${id}`, now));
  } else {
    for (const key of videoDetailKeys(access.options.manifest!)) {
      pages.push(...buildVideoPages(await loadVideoDetailPayload(access.source, key, access.options), key, now));
    }
  }
  // MIG-0404 route map: reserved roots, assets, duplicates and traversal are build errors.
  buildRouteMap(
    pages.filter((p) => p.slug === p.canonicalSlug).map((p) => ({ kind: "video" as const, id: p.videoId, slug: p.slug, aliases: p.slug !== p.videoId ? [p.videoId] : [] })),
    access?.options.generation ?? "fixture",
  );
  return pages;
}
