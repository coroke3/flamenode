/**
 * 作品編集・イベント編集の section permission key。
 * `event_staff.permission_mask` と旧権限キー互換値の取りうる値を
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
  // Old permission keys are still accepted so migrated staff rows keep working.
  | "videos.title"
  | "videos.music_credit"
  | "videos.members"
  | "videos.review_data"
  | "videos.youtube_id"
  | "videos.primary_event";

export type EventEditSectionKey =
  | "event.basic"
  | "event.publish"
  | "event.members"
  | "event.slots"
  | "event.questions"
  | "event.review"
  | "event.notifications"
  | "event.public_api"
  | "event.static_rebuild"
  | "xid.link_requests";

export type CollaboratorPermissionKey =
  | VideoEditSectionKey
  | EventEditSectionKey;
