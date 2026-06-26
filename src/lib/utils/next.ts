/**
 * `?next=` クエリパラメータ等の遷移先パスを検証する。
 *
 * 受け入れる: 同一サイト内の相対パス (例: `/entry/slotted?slot=abc`)。
 * 拒否する:
 *   - 空 / undefined / null
 *   - スキーム付き URL (`https://...`)
 *   - プロトコル相対 (`//evil.com/...`)
 *   - 先頭が `/` でないもの
 *
 * 拒否時は `fallback` を返す。呼び出し側でデフォルトの行き先を決められるようにしている
 * (TOS 同意後は `/dashboard`、未ログイン誘導は `/dashboard` 等、コンテキストで異なる)。
 */
const MAX_NEXT_PATH_LEN = 512;

/**
 * 相対パスとして安全かどうか（オープンリダイレクト・制御文字の排除）。
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("://")) return false;
  if (path.length > MAX_NEXT_PATH_LEN) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

export function sanitizeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  if (!isSafeRelativePath(trimmed)) return fallback;
  return trimmed;
}
