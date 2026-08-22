export const YOUTUBE_REQUIRED_FOR_PUBLIC_MESSAGE =
  "YouTube URLが未設定のため公開できません。投稿者にYouTube URLの追加を依頼してください。";

export type VideoPublicEligibilityResult =
  | { ok: true }
  | { ok: false; code: "youtube_required_for_public"; message: string };

/**
 * Public visibility is a server-side invariant for YouTube-backed videos.
 * Manual and external sources intentionally remain unaffected.
 */
export function validateVideoPublicEligibility(
  video: {
    source_type: string | null | undefined;
    youtube_video_id: string | null | undefined;
  },
  nextStatus: string,
): VideoPublicEligibilityResult {
  if (
    nextStatus === "public" &&
    video.source_type === "youtube" &&
    !video.youtube_video_id?.trim()
  ) {
    return {
      ok: false,
      code: "youtube_required_for_public",
      message: YOUTUBE_REQUIRED_FOR_PUBLIC_MESSAGE,
    };
  }
  return { ok: true };
}
