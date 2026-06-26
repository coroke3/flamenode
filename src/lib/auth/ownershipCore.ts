/**
 * ownership.ts の純粋ロジック (DB / server-only 依存を含まない部分)。
 * テスト容易性のため ownership.ts から切り出している。
 */

import type { VideoEditSectionKey } from "./videoEditSections";

export type SessionUserLike = {
  id: string;
  role?: string | null;
  active_x_user_id?: string | null;
};

export const VIDEO_PERMISSION_ALIASES: Record<
  VideoEditSectionKey,
  readonly string[]
> = {
  "video.basics": ["video.basics", "videos.title"],
  "video.identity": ["video.identity", "videos.title"],
  "video.descriptions": ["video.descriptions", "videos.review_data"],
  "video.credits": ["video.credits", "videos.music_credit"],
  "video.members": ["video.members", "videos.members"],
  "video.member_chapters": [
    "video.member_chapters",
    "video.members",
    "videos.members",
  ],
  "video.youtube_id": ["video.youtube_id", "videos.youtube_id"],
  "video.primary_event": ["video.primary_event", "videos.primary_event"],
  "video.status": ["video.status"],
  "video.chapter_admin": ["video.chapter_admin"],
  "videos.title": ["videos.title", "video.basics", "video.identity"],
  "videos.music_credit": ["videos.music_credit", "video.credits"],
  "videos.members": ["videos.members", "video.members"],
  "videos.review_data": ["videos.review_data", "video.descriptions"],
  "videos.youtube_id": ["videos.youtube_id", "video.youtube_id"],
  "videos.primary_event": ["videos.primary_event", "video.primary_event"],
};

/**
 * 通常編集モード (privilegeMode = "normal") で許可する section key。
 *
 * 設計意図:
 *   - admin role でも safe key のみ。danger key は privilegeMode = "admin" 時のみ。
 *   - イベント管理者も同じ範囲のみ。
 *   - 作品オーナーは privilegeMode を問わず全権 (前段で判定済み)。
 */
export const NORMAL_SAFE_VIDEO_EDIT_KEYS = new Set<VideoEditSectionKey>([
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
  "videos.title",
  "videos.review_data",
  "videos.music_credit",
  "videos.members",
]);

/**
 * privilegeMode = "admin" 時にだけ解放される危険キー。
 * 提出主体変更 / YouTube ID 差し替え / 所属イベント変更 / 公開状態 / チャプター運営。
 */
export const DANGEROUS_ADMIN_VIDEO_EDIT_KEYS = new Set<VideoEditSectionKey>([
  "video.identity",
  "video.youtube_id",
  "video.primary_event",
  "video.status",
  "video.chapter_admin",
  "videos.youtube_id",
  "videos.primary_event",
]);

/**
 * video_members.can_edit が許可する section のホワイトリスト。
 *
 * 重要: 列挙されていないキーは合作メンバーでは絶対に通らない。
 * 特に以下は **永久に許可しない**:
 *   - video.identity / videos.title / video.basics (提出主体・タイトル系)
 *   - videos.youtube_id / video.youtube_id (YouTube ID 差し替え)
 *   - videos.primary_event / video.primary_event (所属イベント変更)
 *   - video.status / video.chapter_admin (公開状態 / チャプター運営)
 */
export const COLLABORATOR_VIDEO_EDIT_KEYS = new Set<VideoEditSectionKey>([
  "video.descriptions",
  "video.members",
  "videos.review_data",
  "videos.members",
  "video.credits",
  "videos.music_credit",
]);

/**
 * allow_user_video_edits で collaborator が触れるキーを拡張するときの
 * 許可してよい section key のホワイトリスト。
 *
 * 一般ログインユーザーやイベント参加者に編集権を配るためのものではない。
 * 既に can_edit=1 で作品に紐付いている合作メンバーが、
 * COLLABORATOR_VIDEO_EDIT_KEYS のデフォルト範囲を超えて触れるキーを
 * イベント単位で増減するための拡張テーブル。
 */
export const USER_DELEGATABLE_KEYS = new Set<string>([
  "videos.title",
  "videos.music_credit",
  "videos.members",
  "videos.review_data",
  "video.descriptions",
  "video.credits",
  "video.members",
]);

export function isSafeNormalVideoEditKey(key: VideoEditSectionKey): boolean {
  return NORMAL_SAFE_VIDEO_EDIT_KEYS.has(key);
}

export function isDangerousAdminVideoEditKey(
  key: VideoEditSectionKey,
): boolean {
  return DANGEROUS_ADMIN_VIDEO_EDIT_KEYS.has(key);
}

export function isUserDelegatableKey(key: VideoEditSectionKey): boolean {
  return USER_DELEGATABLE_KEYS.has(key);
}

/**
 * Active X が運営権限の付与先 X と食い違うとき true（注意表示用）。
 * 運営入場判定には使わない。
 */
export function shouldWarnManageActiveXMismatch(
  activeXUserId: string | null | undefined,
  manageStaffXUserIds: readonly string[],
): boolean {
  const activeX = activeXUserId?.trim() || null;
  if (!activeX) return false;
  if (manageStaffXUserIds.length === 0) return false;
  return !manageStaffXUserIds.includes(activeX);
}

export function parseDelegatablePermissionKeys(
  raw: string | null | undefined,
): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === "string" && USER_DELEGATABLE_KEYS.has(v)) {
        out.add(v);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}
