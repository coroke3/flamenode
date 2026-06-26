export type EventPermissionKey =
  | "event.basic"
  | "event.slots"
  | "event.members"
  | "event.questions"
  | "event.review"
  | "event.notifications"
  | "event.public_api"
  | "event.static_rebuild"
  | "xid.link_requests";

export type VideoPermissionKey =
  | "video.basics"
  | "video.descriptions"
  | "video.credits"
  | "video.members"
  | "video.member_chapters"
  | "video.status"
  | "video.primary_event"
  | "video.youtube_id"
  | "video.identity";

export type PermissionKey = EventPermissionKey | VideoPermissionKey;

export const EVENT_PERMISSION_KEYS: readonly EventPermissionKey[] = [
  "event.basic",
  "event.slots",
  "event.members",
  "event.questions",
  "event.review",
  "event.notifications",
  "event.public_api",
  "event.static_rebuild",
  "xid.link_requests",
];

export const VIDEO_PERMISSION_KEYS: readonly VideoPermissionKey[] = [
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
  "video.status",
  "video.primary_event",
  "video.youtube_id",
  "video.identity",
];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = [
  ...EVENT_PERMISSION_KEYS,
  ...VIDEO_PERMISSION_KEYS,
];

export const DANGEROUS_PERMISSION_KEYS: readonly PermissionKey[] = [
  "event.members",
  "event.public_api",
  "event.static_rebuild",
  "video.status",
  "video.primary_event",
  "video.youtube_id",
  "video.identity",
];

export const PERMISSION_KEY_LABELS: Record<PermissionKey, string> = {
  "event.basic": "イベント基本情報",
  "event.slots": "スロット管理",
  "event.members": "スタッフ管理",
  "event.questions": "カスタム質問",
  "event.review": "審査・承認",
  "event.notifications": "通知・受信箱",
  "event.public_api": "公開API設定",
  "event.static_rebuild": "静的JSON再生成",
  "xid.link_requests": "X ID連携申請",
  "video.basics": "作品基本情報",
  "video.descriptions": "作品説明",
  "video.credits": "楽曲・クレジット",
  "video.members": "作品メンバー",
  "video.member_chapters": "メンバーチャプター",
  "video.status": "公開状態",
  "video.primary_event": "所属イベント",
  "video.youtube_id": "YouTube ID",
  "video.identity": "提出主体",
};

export function isDangerousKey(key: PermissionKey): boolean {
  return (DANGEROUS_PERMISSION_KEYS as readonly string[]).includes(key);
}

export function isValidPermissionKey(key: string): key is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(key);
}
