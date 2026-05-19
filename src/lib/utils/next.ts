/**
 * `?next=` クエリパラメータ等の遷移先パスを検証する。
 *
 * 受け入れる: 同一サイト内の相対パス (例: `/dashboard/post?slot=abc`)。
 * 拒否する:
 *   - 空 / undefined / null
 *   - スキーム付き URL (`https://...`)
 *   - プロトコル相対 (`//evil.com/...`)
 *   - 先頭が `/` でないもの
 *
 * 拒否時は `fallback` を返す。呼び出し側でデフォルトの行き先を決められるようにしている
 * (TOS 同意後は `/dashboard`、未ログイン誘導は `/dashboard` 等、コンテキストで異なる)。
 */
export function sanitizeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}
