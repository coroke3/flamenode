export interface UnslottedPostPolicyEvent {
  allow_unslotted_posts: number | null;
  end_time: number | null;
  visibility_status: string | null;
}

/**
 * 枠なし投稿で一般ユーザーがイベントを所属先として選べるかを判定する。
 *
 * - 保存状態が public のイベントだけを対象にする
 * - allow_unslotted_posts = 1 なら開催前・開催中も許可する
 * - それ以外は明示的な end_time を過ぎた後だけ自動許可する
 *
 * 旧状態の読み替えや開始日時からの終了推測は行わない。
 */
export function isUnslottedPostAllowed(
  event: UnslottedPostPolicyEvent,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (event.visibility_status !== "public") return false;
  if (event.allow_unslotted_posts === 1) return true;
  return event.end_time != null && event.end_time <= now;
}

export function unslottedPostPolicyLabel(
  value: number | null | undefined,
): string {
  return value === 1
    ? "開催前・開催中も許可"
    : "自動（終了前は不許可・終了後は許可）";
}
