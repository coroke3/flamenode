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

export const COLLABORATOR_PERMISSION_LABELS: Record<
  CollaboratorPermissionKey,
  { label: string; description: string }
> = {
  "event.basic": {
    label: "イベント基本情報の編集",
    description: "タイトル、説明、画像、開催期間、受付状態などを変更できます。",
  },
  "event.slots": {
    label: "スロット管理",
    description: "枠の作成、編集、開放、時刻やラベルの変更ができます。",
  },
  "event.members": {
    label: "イベント管理者を登録/編集",
    description: "公開メンバー、内部メンバー、役職ラベル、権限を管理できます。",
  },
  "event.questions": {
    label: "投稿フォーム・一般作品権限(イベント毎)",
    description: "イベント固有の投稿フォーム項目と、投稿後に直せる作品項目を変更できます。",
  },
  "videos.title": {
    label: "作品タイトル編集",
    description: "イベント所属作品のタイトルと表示名を変更できます。",
  },
  "videos.music_credit": {
    label: "楽曲・クレジット編集",
    description: "楽曲名、クレジット、楽曲参照 URL を変更できます。",
  },
  "videos.members": {
    label: "作品メンバー編集",
    description: "メンバー名、X ID、役割、コメント、担当チャプターを変更できます。",
  },
  "videos.review_data": {
    label: "作品説明・振り返り編集",
    description: "紹介文、制作エピソード、使用ソフト、見どころを変更できます。",
  },
  "videos.youtube_id": {
    label: "YouTube ID 編集",
    description: "YouTube URL / ID を変更できます。重複確認が必要です。",
  },
  "videos.primary_event": {
    label: "所属イベント変更",
    description: "primary_event_id や追加所属イベントを変更できます。",
  },
  "video.chapter_admin": {
    label: "チャプター管理",
    description: "イベント所属作品のチャプターコメントを編集・削除できます。",
  },
};

export type VideoVisibilityStatus =
  | "draft"
  | "pending"
  | "public"
  | "limited"
  | "private"
  | "hidden"
  | "archived"
  | "voided";

export const VIDEO_STATUS_LABELS: Record<
  VideoVisibilityStatus,
  { label: string; description: string }
> = {
  draft: {
    label: "下書き",
    description: "投稿者本人だけが見られる作業中の状態です。",
  },
  pending: {
    label: "公開待ち",
    description: "提出済みで運営確認や公開処理を待っている状態です。",
  },
  public: {
    label: "公開",
    description: "一覧やイベントページから閲覧できる通常公開です。",
  },
  limited: {
    label: "限定公開",
    description: "直接 URL からのみ閲覧でき、公開一覧には出ない状態です。",
  },
  private: {
    label: "非公開",
    description: "投稿者本人と管理者だけが閲覧できる状態です。",
  },
  hidden: {
    label: "手動非表示",
    description: "運営判断で通常導線から隠している状態です。",
  },
  archived: {
    label: "アーカイブ",
    description: "論理削除され、通常導線から除外された状態です。",
  },
  voided: {
    label: "無効化",
    description: "重複、権利確認、取り下げなどで無効化された状態です。",
  },
};

export const VOID_REASON_LABELS: Record<
  "x_id_invalid" | "duplicate" | "withdrawn_by_creator" | "operator_decision" | "expired",
  string
> = {
  x_id_invalid: "X ID 不正",
  duplicate: "重複投稿",
  withdrawn_by_creator: "投稿者による取り下げ",
  operator_decision: "運営判断",
  expired: "期限切れ",
};
