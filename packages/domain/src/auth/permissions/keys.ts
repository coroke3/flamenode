export type EventPermissionKey =
  | "event.basic"
  | "event.publish"
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
  | "video.identity"
  | "video.permissions";

export type PermissionKey = EventPermissionKey | VideoPermissionKey;

export type PermissionCategory = "event" | "video" | "xid" | "danger";

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  description: string;
  category: PermissionCategory;
  dangerous?: boolean;
  adminOnly?: boolean;
};

export const EVENT_PERMISSION_KEYS: readonly EventPermissionKey[] = [
  "event.basic",
  "event.publish",
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
  "video.permissions",
];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = [
  ...EVENT_PERMISSION_KEYS,
  ...VIDEO_PERMISSION_KEYS,
];

export const DANGEROUS_PERMISSION_KEYS: readonly PermissionKey[] = [
  "event.members",
  "event.public_api",
  "event.static_rebuild",
  "video.primary_event",
  "video.youtube_id",
  "video.identity",
  "video.permissions",
];

export const PERMISSION_DEFINITIONS: Record<PermissionKey, PermissionDefinition> = {
  "event.basic": {
    key: "event.basic",
    label: "イベント基本情報",
    description: "タイトル、説明、画像、開催期間などを変更できます。",
    category: "event",
  },
  "event.publish": {
    key: "event.publish",
    label: "受付・公開設定",
    description: "公開状態、受付期間、旧公開フラグを変更できます。",
    category: "event",
  },
  "event.slots": {
    key: "event.slots",
    label: "枠管理",
    description: "枠の作成、編集、解放、時刻やラベルの変更ができます。",
    category: "event",
  },
  "event.members": {
    key: "event.members",
    label: "スタッフ管理",
    description: "公開メンバー、内部メンバー、役職ラベル、権限を管理できます。",
    category: "event",
    dangerous: true,
  },
  "event.questions": {
    key: "event.questions",
    label: "投稿フォーム・質問",
    description: "イベント固有の投稿フォーム、カスタム質問、作品編集権限を変更できます。",
    category: "event",
  },
  "event.review": {
    key: "event.review",
    label: "審査・承認",
    description: "投稿作品の確認や審査に関わる操作ができます。",
    category: "event",
  },
  "event.notifications": {
    key: "event.notifications",
    label: "通知・受信箱",
    description: "イベント運営向け通知や受信箱を確認・処理できます。",
    category: "event",
  },
  "event.public_api": {
    key: "event.public_api",
    label: "公開API設定",
    description: "イベント公開APIの有効化や公開範囲を変更できます。",
    category: "danger",
    dangerous: true,
    adminOnly: true,
  },
  "event.static_rebuild": {
    key: "event.static_rebuild",
    label: "静的JSON再生成",
    description: "公開ページ向け静的JSON再生成を操作できます。",
    category: "danger",
    dangerous: true,
    adminOnly: true,
  },
  "xid.link_requests": {
    key: "xid.link_requests",
    label: "X ID連携申請",
    description: "X ID連携申請を承認・却下できます。",
    category: "xid",
    adminOnly: true,
  },
  "video.basics": {
    key: "video.basics",
    label: "作品基本情報",
    description: "作品タイトルなどの基本情報を変更できます。",
    category: "video",
  },
  "video.descriptions": {
    key: "video.descriptions",
    label: "作品説明",
    description: "紹介文、制作エピソード、見どころなどを変更できます。",
    category: "video",
  },
  "video.credits": {
    key: "video.credits",
    label: "楽曲・クレジット",
    description: "楽曲名、クレジット、楽曲参照URLを変更できます。",
    category: "video",
  },
  "video.members": {
    key: "video.members",
    label: "作品メンバー",
    description: "メンバー名、X ID、役割、コメントを変更できます。",
    category: "video",
  },
  "video.member_chapters": {
    key: "video.member_chapters",
    label: "メンバーチャプター",
    description: "メンバーごとの担当チャプターを変更できます。",
    category: "video",
  },
  "video.status": {
    key: "video.status",
    label: "公開状態",
    description: "審査結果や作品の公開状態を変更できます。",
    category: "video",
  },
  "video.primary_event": {
    key: "video.primary_event",
    label: "所属イベント",
    description: "primary_event_id や追加所属イベントを変更できます。",
    category: "danger",
    dangerous: true,
    adminOnly: true,
  },
  "video.youtube_id": {
    key: "video.youtube_id",
    label: "YouTube ID",
    description: "YouTube URL / ID を変更できます。重複確認が必要です。",
    category: "danger",
    dangerous: true,
    adminOnly: true,
  },
  "video.identity": {
    key: "video.identity",
    label: "提出主体",
    description: "作品の提出主体や作者 ID に関わる情報を変更できます。",
    category: "danger",
    dangerous: true,
    adminOnly: true,
  },
  "video.permissions": {
    key: "video.permissions",
    label: "共同編集権限",
    description:
      "合作メンバーへの共同編集権限 (video_members.can_edit) を付与・解除できます。",
    category: "danger",
    dangerous: true,
  },
};

export function isDangerousKey(key: PermissionKey): boolean {
  return PERMISSION_DEFINITIONS[key].dangerous === true;
}

export function isAdminOnlyKey(key: PermissionKey): boolean {
  return PERMISSION_DEFINITIONS[key].adminOnly === true;
}

export function isValidPermissionKey(key: string): key is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(key);
}