/** 公開一覧・静的JSON・プロフィール表示に載せてよい X ID 承認状態（編集権限とは別）。 */
export const PUBLIC_LISTABLE_X_APPROVAL_STATUSES = [
  "approved",
  "pending",
  "imported",
] as const;

export type PublicListableXApprovalStatus =
  (typeof PUBLIC_LISTABLE_X_APPROVAL_STATUSES)[number];

/** workers/json-generator 等の生 SQL 用 IN リスト。 */
export const PUBLIC_LISTABLE_X_APPROVAL_SQL_IN =
  PUBLIC_LISTABLE_X_APPROVAL_STATUSES.map((status) => `'${status}'`).join(
    ", ",
  );
