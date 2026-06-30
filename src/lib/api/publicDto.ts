/**
 * 公開 API ホワイトリスト DTO。
 *
 * `/api/videos` と `/api/events` が返してよいフィールドだけを明示する。
 * 内部用 ID (Discord ID / active_x_user_id / linked_discord_user_id)、認証関連
 * (verification_token / access_token / refresh_token)、運用情報 (internal_note
 * / private note / void_detail_private / is_banned / TOS / role / email) などは
 * 一切公開してはならない。
 *
 * 参照: `.claude/flamenode/phases/06-public-api-health-security.md`
 */

/** /api/videos が返してよい列のキー。 */
export const PUBLIC_VIDEO_KEYS = [
  "id",
  "title",
  "youtube_video_id",
  "display_name",
  "icon_url",
  "primary_event_id",
  "scheduled_time",
  "status",
] as const;

export type PublicVideoKey = (typeof PUBLIC_VIDEO_KEYS)[number];

/** クライアントへ返す公開作品 DTO。 */
export interface PublicVideoDto {
  id: string;
  title: string;
  /** YouTube 側が unlisted でも FlameNode 上 public なら値を含む。 */
  youtube_video_id: string | null;
  display_name: string | null;
  icon_url: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  /** 常に "public"。FlameNode 内の公開状態のみを返す。 */
  status: "public";
}

/** /api/events が返してよい列のキー。 */
export const PUBLIC_EVENT_KEYS = [
  "id",
  "title",
  "event_type",
  "explanation",
  "icon_url",
  "img_url",
  "accent_color",
  "is_active",
  "is_entry_open",
  "is_archived",
  "event_group_id",
  "slot_type",
  "slot_visibility_mode",
  "start_time",
  "end_time",
  "max_slots_per_video",
  "max_consecutive_slots_per_entry",
] as const;

export type PublicEventKey = (typeof PUBLIC_EVENT_KEYS)[number];

/** クライアントへ返す公開イベント DTO。 */
export interface PublicEventDto {
  id: string;
  title: string;
  event_type: "event" | "collabo" | "type" | "other" | null;
  explanation: string | null;
  icon_url: string | null;
  img_url: string | null;
  accent_color: string | null;
  is_active: number;
  is_entry_open: number;
  is_archived: number;
  event_group_id: string | null;
  slot_type: "time" | "count" | null;
  slot_visibility_mode: "public_name" | "anonymous" | "hidden" | null;
  start_time: number | null;
  end_time: number | null;
  max_slots_per_video: number;
  max_consecutive_slots_per_entry: number;
}

/**
 * 絶対に公開 API から返してはならないキーの一覧。
 * `assertNoForbiddenKeys` が再帰的に検査する。
 */
export const FORBIDDEN_PUBLIC_KEYS: ReadonlySet<string> = new Set([
  // 個人特定 ID
  "submitted_by_discord_user_id",
  "creator_x_user_id",
  "discord_user_id",
  "discord_id",
  "linked_discord_user_id",
  "active_x_user_id",
  // 認証関連
  "email",
  "email_verified",
  "verification_token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "providerAccountId",
  // 権限・状態
  "role",
  "is_banned",
  "tos_accepted_at",
  "tos_version",
  // 運用ノート
  "internal_note",
  "private_note",
  "void_detail_private",
  // 管理者向け履歴 / 通知 payload
  "history_logs",
  "notification_payload",
  // 編集者の代理 X user id (公開不可)
  "representative_x_user_id",
]);

/** 公開 API リストに `limit` の絶対上限を掛ける。 */
export const MAX_PUBLIC_LIST_LIMIT = 48;

/** /api/events の `limit` 絶対上限 (イベントは変更頻度が低いため作品より大きい値を許容)。 */
export const MAX_PUBLIC_EVENT_LIMIT = 60;

/**
 * 与えられたオブジェクトを `keys` だけに絞った浅いコピーで返す。
 * 余分なキーはここで完全に落ちる。
 */
export function pickKeys<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) {
    out[k] = source[k];
  }
  return out;
}

/**
 * 公開 API のレスポンスに禁止キーが含まれていないかを再帰的に検査する。
 * 漏洩があれば throw する。本番経路では呼ばず、開発時テストや
 * `scripts/check-public-api-leaks.mjs` の境界判定でのみ使う想定。
 */
export function assertNoForbiddenKeys(
  value: unknown,
  path: string = "$",
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(k)) {
      throw new Error(
        `Public API leak: forbidden key "${k}" at ${path}.${k}`,
      );
    }
    assertNoForbiddenKeys(v, `${path}.${k}`);
  }
}
