import { isValidPermissionKey, type PermissionKey } from "./keys.ts";

export const LEGACY_PERMISSION_ALIASES: Record<string, PermissionKey> = {
  "videos.title": "video.basics",
  "videos.music_credit": "video.credits",
  "videos.members": "video.members",
  "videos.review_data": "video.descriptions",
  "videos.youtube_id": "video.youtube_id",
  "videos.primary_event": "video.primary_event",
  "video.chapter_admin": "video.member_chapters",
};

export function canonicalizePermissionKey(
  key: string,
): PermissionKey | null {
  if (isValidPermissionKey(key)) return key;
  return LEGACY_PERMISSION_ALIASES[key] ?? null;
}

export function expandPermissionAliases(key: string): PermissionKey[] {
  const canonical = canonicalizePermissionKey(key);
  return canonical ? [canonical] : [];
}
