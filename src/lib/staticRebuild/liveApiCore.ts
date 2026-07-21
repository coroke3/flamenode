export type LiveSlotVisibilityMode =
  | "public_name"
  | "anonymous"
  | "hidden"
  | null;

export function projectLiveSlotIdentity(
  visibilityMode: LiveSlotVisibilityMode,
  publicVideoId: string | null,
  displayName: string | null,
): { video_id: string | null; display_name: string | null } {
  if (visibilityMode !== "public_name") {
    return { video_id: null, display_name: null };
  }
  return { video_id: publicVideoId, display_name: displayName };
}
