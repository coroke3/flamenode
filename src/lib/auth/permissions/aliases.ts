import { isValidPermissionKey, type PermissionKey } from "./keys.ts";

/** 旧スタッフ権限キー → 現行 PermissionKey への一方向正規化。 */
const LEGACY_TO_CANONICAL: Record<string, PermissionKey> = {
  "videos.title": "video.basics",
  "videos.review_data": "video.descriptions",
  "videos.music_credit": "video.credits",
  "videos.members": "video.members",
  "video.chapter_admin": "video.member_chapters",
  "videos.primary_event": "video.primary_event",
  "videos.youtube_id": "video.youtube_id",
};

export function canonicalizePermissionKey(
  key: string,
): PermissionKey | null {
  if (isValidPermissionKey(key)) return key;
  return LEGACY_TO_CANONICAL[key] ?? null;
}

/**
 * 要求キーを満たすために staff 行が持つべき正規キー一覧。
 * 旧キー (videos.*) は正規キー 1 件に畳む。
 */
export function expandPermissionAliases(key: string): PermissionKey[] {
  const canonical = canonicalizePermissionKey(key);
  return canonical ? [canonical] : [];
}
