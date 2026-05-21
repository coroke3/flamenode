/**
 * HTTP/HTTPS URL をサニタイズ・正規化する。
 *
 * 以下の条件を満たす場合に正規化された URL 文字列を返し、満たさない場合は null を返す:
 * - 空文字列でないこと
 * - 指定された maxLength（デフォルト 500 文字）以下であること
 * - 有効な URL であり、プロトコルが http: または https: であること
 */
export function normalizeHttpUrl(
  raw: string | null | undefined,
  options: { maxLength?: number } = {},
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.length > (options.maxLength ?? 500)) return null;

  try {
    const url = new URL(s);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
