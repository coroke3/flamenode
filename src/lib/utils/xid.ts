export function normalizeXId(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

const X_HANDLE_RE = /^[a-z0-9_]{1,20}$/;

/**
 * ユーザー入力から X ハンドルを解析する。
 * 受け付け: username / @username / x.com・twitter.com のプロフィール URL。
 * 正規化後は小文字ハンドル。無効なら null。
 * 文字数上限は X の 20 文字に合わせる（21 文字以上は拒否）。
 */
export function parseXIdentityInput(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  let candidate = trimmed;

  const urlMatch = candidate.match(
    /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/?(?:[?#].*)?$/i,
  );
  if (urlMatch) {
    candidate = urlMatch[1] ?? "";
  } else if (/^https?:\/\//i.test(candidate) || candidate.includes("/")) {
    // 外部 URL・余分なパス付きは拒否
    return null;
  } else {
    candidate = candidate.replace(/^@+/, "");
  }

  const normalized = candidate.toLowerCase();
  if (!X_HANDLE_RE.test(normalized)) return null;
  return normalized;
}
