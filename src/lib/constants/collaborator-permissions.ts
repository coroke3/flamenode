/**
 * イベント協力者の permission_key 許可値（設計 FlameNode-Legacy-Data-Compatibility と整合）。
 * Client / Server 双方から import 可（"use server" モジュールに置かない）。
 */
export const COLLABORATOR_PERMISSION_KEYS = [
  "event.basic",
  "event.slots",
  "event.members",
  "event.questions",
  "videos.title",
  "videos.music_credit",
  "videos.members",
  "videos.review_data",
  "videos.youtube_id",
  "videos.primary_event",
] as const;

export type CollaboratorPermissionKey =
  (typeof COLLABORATOR_PERMISSION_KEYS)[number];
