export type VideoPublicEligibilityResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Public visibility only requires the normal video fields validated by the
 * action/schema.  A YouTube-backed work may intentionally have no YouTube ID:
 * its title, creator, event, and other video information can still be shown
 * on the public detail page while the player remains unavailable.
 *
 * Keep this server-side entry point so all visibility mutations share the same
 * future eligibility hook.  Do not reintroduce a YouTube-ID requirement here.
 */
export function validateVideoPublicEligibility(
  _video: {
    source_type: string | null | undefined;
    youtube_video_id: string | null | undefined;
  },
  _nextStatus: string,
): VideoPublicEligibilityResult {
  return { ok: true };
}
