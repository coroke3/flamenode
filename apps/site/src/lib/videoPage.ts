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
import { buildPublicVideoViewModelFromStatic, filterPublicVideoDetailEvents } from "../../../../src/lib/publicData/publicVideoDetailViewModel.ts";
import { normalizeStaticVideoDetail } from "../../../../src/lib/publicData/staticVideoDetailCore.ts";
import { computeEventStatus, eventStatusLabel, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";
import { formatChapterTime } from "../../../../src/lib/utils/chapterTime.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import { parseCanonicalXId } from "../../../../src/lib/utils/xid.ts";
import { normalizeHttpUrl } from "../../../../src/lib/utils/url.ts";
import { extractYoutubeId, videoPageHref, youtubeThumbUrl } from "../../../../src/lib/youtube/id.ts";
import { extractYoutubePlaylistId } from "../../../../src/lib/youtube/playlist.ts";
import { buildRouteMap } from "./routeMap.ts";
import { buildPageHead, compactText, siteOrigin, type PageHead } from "./pageHead.ts";
import { SnapshotBuildError, eventDetailKey, loadEventPayloadSnapshot, loadVideoDetailPayload, videoDetailKeys } from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";
import { loadPublicXIconMapForBuild, projectVideoMemberPresentation } from "./publicIconMap.ts";
import { hasProjectedPublicProfile, type PublicXIconEntry } from "../../../../src/lib/publicData/publicIconProjection.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "./videoFixtures.ts";
import { FIXTURE_EVENT_DETAIL_PAYLOADS } from "./eventFixtures.ts";

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

const PUBLIC_YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/** Public snapshot text is not an outbound URL authorization. Only absolute
 * web URLs may be linked; a "YouTube channel" additionally needs a trusted
 * YouTube host over HTTPS. Invalid/legacy values render as plain text instead. */
function safePublicExternalUrl(value: unknown, youtubeChannel = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeHttpUrl(value, { maxLength: 500 });
  if (normalized === null) return null;
  if (!youtubeChannel) return normalized;
  // The shared normalizer has already validated the absolute HTTP(S) URL.
  const url = new URL(normalized);
  return url.protocol === "https:" && PUBLIC_YOUTUBE_HOSTS.has(url.hostname.toLowerCase())
    ? normalized
    : null;
}

/**
 * Validate raw snapshot link values before the shared display normalizer trims
 * controls or coerces non-strings (including singleton arrays) into URLs.
 * Keep its legacy normalization behavior for the other display fields.
 */
function normalizeVideoDetailForBuild(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const snapshot = payload as Parameters<typeof normalizeStaticVideoDetail>[0];
  const raw = snapshot.video;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizeStaticVideoDetail({
    ...snapshot,
    video: {
      ...raw,
      creator_youtube_channel_url: safePublicExternalUrl(raw.creator_youtube_channel_url, true),
      music_reference_url: safePublicExternalUrl(raw.music_reference_url),
    },
  });
}

export function buildVideoPages(
  payload: unknown,
  key: string,
  now: number = Math.floor(Date.now() / 1000),
  iconMap: ReadonlyMap<string, PublicXIconEntry> = new Map(),
  relatedAllowedIds: ReadonlySet<string> | null = null,
  allowedEventIds: ReadonlySet<string> | null = null,
): VideoPage[] {
  const normalized = normalizeVideoDetailForBuild(payload);
  if (!normalized || normalized.video.visibility_status !== "public") throw new VideoPageBuildError(key);
  // Reject a valid-digest snapshot whose entity ID disagrees with its manifest-authorized key.
  // Otherwise an allowed object could publish a page under a different route (including its alias).
  const snapshotId = /^snapshot\/video-detail\/([A-Za-z0-9_-]{1,64})\.json$/.exec(key)?.[1];
  if (snapshotId && normalized.video.id !== snapshotId) throw new VideoPageBuildError(key);
  // CURRENT fences stale event IDs before projecting the public video page.
  // A public video snapshot does not authorize a withdrawn event title or link.
  const deniedEventIds = allowedEventIds
    ? new Set(
        [...normalized.eventIds, ...normalized.publicEvents.map((event) => event.id)]
          .filter((id) => !allowedEventIds.has(id)),
      )
    : null;
  const detail = deniedEventIds
    ? filterPublicVideoDetailEvents(normalized, deniedEventIds)
    : normalized;
  // A digest-valid snapshot can still contain stale related cards. A related
  // video must have its own currently manifest-allowed (and not blocked) public
  // detail snapshot, otherwise do not publish its title or creator on this page.
  // Derive the deny set *before* the shared 12-card projection so reserve/random
  // cards can replace withdrawn or missing targets without underfilling.
  const relatedBlockedIds = relatedAllowedIds
    ? new Set(
        [...detail.relatedVideos, ...detail.relatedReserve, ...detail.relatedRandomReserve]
          .filter((candidate) => !relatedAllowedIds.has(candidate.id))
          .map((candidate) => candidate.id),
      )
    : null;
  const vm = buildPublicVideoViewModelFromStatic(detail, { relatedBlockedIds });
  const { video } = vm;
  const youtubeVideoId = video.youtube_video_id?.trim() || null;
  const youtubeId = extractYoutubeId(youtubeVideoId);
  const canonicalSlug = youtubeId ?? video.id;
  // The public snapshot is integrity-checked, but an old row may still have
  // a non-canonical X handle. Never turn that handle into a navigable
  // /user/ URL or an external X link (including dot/slash segments).
  const creatorId = parseCanonicalXId(video.creator_x_user_id);
  const creatorName = video.creator_display_name?.trim() || "作者未設定";
  const creatorHref = creatorId && ((video.creator_has_public_profile ?? false) || hasProjectedPublicProfile({ xUserId: creatorId, iconMap })) ? `/user/${creatorId}` : null;
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
      xUserId: creatorId,
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
    members: vm.publicMembers.map((m) => {
      const xUserId = parseCanonicalXId(m.x_user_id);
      return {
        id: m.id,
        name: m.display_name,
        xUserId,
        ...projectVideoMemberPresentation({ ...m, x_user_id: xUserId }, iconMap),
        role: m.role_label,
        comment: m.comment ?? null,
        chapterTimes: vm.memberChapters.filter((c) => c.video_member_id === m.id).map((c) => formatChapterTime(c.chapter_time)),
      };
    }),
    chapters: chapters.map((c) => ({ id: c.id, timeLabel: formatChapterTime(c.t), label: c.label, authorName: c.author, kind: c.kind })),
    related: vm.relatedVideos.map((r) => ({
      href: videoPageHref(r),
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

/**
 * CURRENT's optional R2 event-base lookup is represented by a verified event-detail build snapshot.
 * Never expose a playlist for a mismatched or non-public event, even when its envelope is allowed.
 */
function publicEventDetail(payload: unknown, expectedId: string): { playlistId: string | null } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as { event?: unknown }).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const row = event as Record<string, unknown>;
  if (row.id !== expectedId || row.visibility_status !== "public" || typeof row.title !== "string" || !row.title.trim()) return null;
  return { playlistId: extractYoutubePlaylistId(typeof row.youtube_playlist_id === "string" ? row.youtube_playlist_id : null) };
}

export async function loadVideoPagesForBuild(
  env: Record<string, string | undefined> = process.env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VideoPage[]> {
  const access = snapshotAccessFromEnv(env);
  const iconMap = await loadPublicXIconMapForBuild(env);
  // videoDetailKeys already applies both the allowedKeys and blockedKeys
  // visibility fences. A missing related detail target must also be treated as
  // unavailable, not just a target explicitly present in blockedKeys.
  const relatedAllowedIds = access
    ? new Set(videoDetailKeys(access.options.manifest!).map((key) =>
        key.slice("snapshot/video-detail/".length, -".json".length)))
    : null;
  const eventAllowedKeys = access ? new Set(access.options.manifest!.allowedKeys) : null;
  const eventBlockedKeys = access ? new Set(access.options.manifest!.blockedKeys) : null;
  const pages: VideoPage[] = [];
  // Cache only the authorization outcome and playlist ID, not entire event payloads.
  // The same verified detail authorizes visible event labels and optional playlists.
  const eventDetails = new Map<string, { playlistId: string | null } | null>();
  const loadAuthorizedEvent = async (eventId: string): Promise<void> => {
    if (eventDetails.has(eventId)) return;
    let eventPayload: unknown = null;
    if (!access) {
      eventPayload = FIXTURE_EVENT_DETAIL_PAYLOADS[eventId] ?? null;
    } else {
      const key = eventDetailKey(eventId);
      if (eventAllowedKeys?.has(key) && !eventBlockedKeys?.has(key)) {
        try {
          eventPayload = await loadEventPayloadSnapshot(access.source, key, access.options);
        } catch (error) {
          // An absent/withdrawn target loses its event label and playlist.
          // A corrupt digest, generation or encoding is a build failure.
          if (!(error instanceof SnapshotBuildError && (error.code === "SNAPSHOT_MISSING" || error.code === "NOT_PUBLIC"))) {
            throw error;
          }
        }
      }
    }
    eventDetails.set(eventId, publicEventDetail(eventPayload, eventId));
  };
  const buildWithPlaylist = async (payload: unknown, key: string): Promise<void> => {
    const normalized = normalizeVideoDetailForBuild(payload);
    const references = normalized
      ? [...new Set([...normalized.eventIds, ...normalized.publicEvents.map((event) => event.id)])]
      : [];
    // Keep peak memory bounded: never parse many large event-detail envelopes concurrently.
    for (const eventId of references) await loadAuthorizedEvent(eventId);
    const allowedEventIds = new Set(references.filter((id) => Boolean(eventDetails.get(id))));
    const built = buildVideoPages(payload, key, now, iconMap, relatedAllowedIds, allowedEventIds);
    const eventId = built[0]?.data.primaryEvent?.id;
    // Normalize for rendering, but never let the generic string/number coercers
    // turn arrays or objects into a valid authorization key or future timestamp.
    const video = normalized?.video;
    const rawVideo = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { video?: unknown }).video
      : null;
    const raw = rawVideo && typeof rawVideo === "object" && !Array.isArray(rawVideo)
      ? rawVideo as Record<string, unknown>
      : null;
    const rawSchedule = raw?.scheduled_time;
    // The shared normalizer floors timestamps for legacy display compatibility.
    // Playlist authorization must not round a past fractional timestamp up to
    // the current second, which would turn a past release into a future release.
    const exactScheduledTime = typeof rawSchedule === "number" || typeof rawSchedule === "string"
      ? Number(rawSchedule)
      : NaN;
    const scheduledTime = Number.isFinite(exactScheduledTime) &&
      Math.abs(exactScheduledTime) <= 8.64e12 && video?.scheduled_time != null
      ? exactScheduledTime
      : null;
    const primaryEventId = typeof raw?.primary_event_id === "string"
      ? video?.primary_event_id ?? null
      : null;

    // CURRENT looks up a playlist only for the video-selected primary event.
    // Display fallback events must not inherit an unrelated event's playlist.
    // Preserve CURRENT second-granularity scheduling semantics: a timestamp
    // within the current second is not a future scheduled release, even if the
    // supplied raw value has fractional microseconds.
    if (!eventId || eventId !== primaryEventId || scheduledTime == null || Math.floor(scheduledTime) <= now) {
      pages.push(...built);
      return;
    }

    const playlistId = eventDetails.get(eventId)?.playlistId ?? null;
    if (!playlistId) {
      pages.push(...built);
      return;
    }

    const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    pages.push(...built.map((page) => ({
      ...page,
      data: {
        ...page.data,
        primaryEvent: page.data.primaryEvent
          ? { ...page.data.primaryEvent, playlistUrl }
          : null,
      },
    })));
  };

  if (!access) {
    for (const [id, payload] of Object.entries(FIXTURE_VIDEO_DETAIL_PAYLOADS)) {
      await buildWithPlaylist(payload, `fixture:${id}`);
    }
  } else {
    for (const key of videoDetailKeys(access.options.manifest!)) {
      await buildWithPlaylist(await loadVideoDetailPayload(access.source, key, access.options), key);
    }
  }
  // MIG-0404 route map: reserved roots, assets, duplicates and traversal are build errors.
  buildRouteMap(
    pages.filter((p) => p.slug === p.canonicalSlug).map((p) => ({ kind: "video" as const, id: p.videoId, slug: p.slug, aliases: p.slug !== p.videoId ? [p.videoId] : [] })),
    access?.options.generation ?? "fixture",
  );
  return pages;
}
