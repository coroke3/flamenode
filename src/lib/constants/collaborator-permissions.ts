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
  "video.chapter_admin",
] as const;

export type CollaboratorPermissionKey =
  (typeof COLLABORATOR_PERMISSION_KEYS)[number];

/** 各 permission_key の日本語ラベルと説明文 (管理 UI 用)。 */
export const COLLABORATOR_PERMISSION_LABELS: Record<
  CollaboratorPermissionKey,
  { label: string; description: string }
> = {
  "event.basic": {
    label: "イベント基本情報の編集",
    description:
      "タイトル、説明、画像、開催期間、受付状態などを変更できます。",
  },
  "event.slots": {
    label: "スロット (枠) の作成・編集",
    description:
      "枠の一括生成、確保済み枠の解放、ラベルや時刻の修正が行えます。",
  },
  "event.members": {
    label: "運営メンバーの管理",
    description:
      "公開/非公開の運営メンバー、役職ラベル、代表者候補を編集できます。",
  },
  "event.questions": {
    label: "提出フォームの設問編集",
    description:
      "イベント固有のカスタム質問、編集可能フィールド設定を変更できます。",
  },
  "videos.title": {
    label: "作品のタイトル編集",
    description: "イベント所属作品のタイトル・表示名・読み方を変更できます。",
  },
  "videos.music_credit": {
    label: "作品の楽曲・クレジット編集",
    description: "楽曲名、クレジット、楽曲参考 URL を変更できます。",
  },
  "videos.members": {
    label: "作品の合作メンバー編集",
    description: "メンバー名・X ID・役割・コメント・並び順を編集できます。",
  },
  "videos.review_data": {
    label: "振り返り上映用データの編集",
    description:
      "制作エピソード、使用ソフト、カスタム回答、見どころ等を編集できます。",
  },
  "videos.youtube_id": {
    label: "作品の YouTube ID 編集",
    description: "YouTube 動画 URL / ID の差し替えができます (重複登録には注意)。",
  },
  "videos.primary_event": {
    label: "作品の所属イベント変更",
    description:
      "primary_event_id を変更できます (担当外イベントへの変更は管理者確認が必要)。",
  },
  "video.chapter_admin": {
    label: "チャプターコメントの管理",
    description:
      "イベント所属作品のチャプターコメントを運営権限で編集・削除できます。",
  },
};

/** 動画ステータスの日本語ラベル。 */
export const VIDEO_STATUS_LABELS: Record<
  | "draft"
  | "pending"
  | "x_reapply_required"
  | "public"
  | "unlisted"
  | "private"
  | "voided",
  { label: string; description: string }
> = {
  draft: { label: "下書き", description: "投稿者本人だけが見られる作業中状態。" },
  pending: {
    label: "審査待ち",
    description: "提出済みで運営の確認・YouTube 同期待ち。",
  },
  x_reapply_required: {
    label: "X ID 再申請待ち",
    description: "X ID 却下後、本人による再申請を待つ調整中の状態。",
  },
  public: { label: "公開", description: "通常公開。一覧やイベントから閲覧可。" },
  unlisted: {
    label: "限定公開",
    description: "直リンクからのみ閲覧可。一覧には出ない。",
  },
  private: {
    label: "非公開",
    description: "投稿者本人と管理者だけが閲覧できる。",
  },
  voided: {
    label: "無効化",
    description: "公開・上映・統計から除外する論理削除。物理削除ではない。",
  },
};

/** void_reason_category の日本語ラベル。 */
export const VOID_REASON_LABELS: Record<
  "x_id_invalid" | "duplicate" | "withdrawn_by_creator" | "operator_decision" | "expired",
  string
> = {
  x_id_invalid: "X ID 不備",
  duplicate: "重複投稿",
  withdrawn_by_creator: "投稿者都合",
  operator_decision: "運営判断",
  expired: "期限切れ",
};
