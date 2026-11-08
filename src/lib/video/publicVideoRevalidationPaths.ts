import { extractYoutubeId } from "../youtube/id.ts";

// A corrupt legacy video ID must not produce a second root or foreign-host path.
// Public video details are routed by one path segment (internal ID / YouTube ID).
const SAFE_INTERNAL_VIDEO_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Invalidate BOTH publicly accessible detail aliases after a visibility change.
 *
 * A video can be visited at /{videos.id} and /{youtube_video_id}. Revalidating
 * only the YouTube alias can leave the internal-id page stale after an admin
 * makes the video private. Normalize legacy YouTube URLs and refuse malformed
 * internal IDs rather than passing protocol-relative or multi-segment paths
 * to Next's revalidatePath.
 */
export function publicVideoRevalidationPaths(
  internalId: string,
  youtubeVideoId: string | null | undefined,
): string[] {
  const paths: string[] = [];
  if (SAFE_INTERNAL_VIDEO_ID.test(internalId)) paths.push(`/${internalId}`);
  const youtubeId = extractYoutubeId(youtubeVideoId);
  if (youtubeId && youtubeId !== internalId) paths.push(`/${youtubeId}`);
  return paths;
}
