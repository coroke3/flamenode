/**
 * 作品編集・イベント編集の section permission key。
 * `eventStaffPermissions.permission_key` に格納される文字列の取りうる値を
 * 型で固定するためのリテラル union。
 *
 * canEditVideo / canEditEvent の requiredKey はこの型を必須に取り、
 * 「省略すれば広く編集可」になる不具合を塞ぐ (consistency audit 4-3)。
 */
export type VideoEditSectionKey =
  | "video.basics"
  | "video.identity"
  | "video.descriptions"
  | "video.credits"
  | "video.members"
  | "video.member_chapters"
  | "video.youtube_id"
  | "video.primary_event"
  | "video.status"
  | "video.chapter_admin"
  // Legacy / admin UI permission keys. Keep these accepted so
  // Old permission keys are still accepted so migrated event_staff_permissions keep working.
  | "videos.title"
  | "videos.music_credit"
  | "videos.members"
  | "videos.review_data"
  | "videos.youtube_id"
  | "videos.primary_event";

export type EventEditSectionKey =
  | "event.basic"
  | "event.members"
  | "event.slots";

export type CollaboratorPermissionKey =
  | VideoEditSectionKey
  | EventEditSectionKey;
