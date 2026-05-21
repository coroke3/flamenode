/**
 * SQLite LIKE 用のメタ文字 (`\`, `%`, `_`) をエスケープする。
 *
 * - `%` と `_` はワイルドカードなので、ユーザー入力に含まれていたら
 *   そのまま検索したい (= リテラル化する)。
 * - `\` は自前で `ESCAPE '\\'` を付ける場合のエスケープ文字。
 *
 * 利用例:
 *   ```ts
 *   const term = `%${escapeLike(q)}%`;
 *   db.where(sql`${col} LIKE ${term} ESCAPE '\\'`);
 *   ```
 * もしくは Drizzle の `like(col, term)` を使う際、内部的に escape を付けないため
 * 呼び出し側で明示する必要がある。
 */
export function escapeLike(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw).replace(/[\\%_]/g, "\\$&");
}

/**
 * ページング用に limit / offset を整える。
 *
 * - `page`: 1-based。1 未満や NaN は 1。
 * - `pageSize`: 既定値 + 最大上限。
 *
 * 戻り値の `pageSize` は実際にクエリへ渡す値で、呼び出し側で `.limit()` に使う。
 * `offset` は `(page-1) * pageSize`。
 */
export function clampPaging(args: {
  page: unknown;
  pageSize: unknown;
  defaultPageSize: number;
  maxPageSize: number;
}): { page: number; pageSize: number; offset: number } {
  const rawPage = Number(args.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const rawSize = Number(args.pageSize);
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(Math.floor(rawSize), args.maxPageSize)
      : args.defaultPageSize;
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/** 件数とページサイズから総ページ数を出す。0 件なら 1 を返す (空ページを 1 ページ目として扱う)。 */
export function totalPagesFor(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
