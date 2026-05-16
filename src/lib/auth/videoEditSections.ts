/**
 * 作品編集・イベント編集の section permission key。
 * `eventCollaboratorPermissions.permission_key` に格納される文字列の取りうる値を
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
  | "video.status"
  | "video.chapter_admin";

export type EventEditSectionKey =
  | "event.basic"
  | "event.members"
  | "event.slots";

export type CollaboratorPermissionKey =
  | VideoEditSectionKey
  | EventEditSectionKey;
