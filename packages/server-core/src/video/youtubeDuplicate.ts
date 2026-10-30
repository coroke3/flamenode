export function isYoutubeIdUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!message) return false;
  if (!/UNIQUE constraint failed/i.test(message)) return false;
  return (
    /videos\.youtube_video_id/i.test(message) ||
    /videos_youtube_id_active_uniq/i.test(message)
  );
}
