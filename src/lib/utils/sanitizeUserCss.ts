/**
 * ユーザー入力 CSS を Custom Page で表示する前に通すサニタイザ。
 *
 * 安全性のために以下を行う:
 * - @import ルールを除去 (外部CSS読み込み防止)
 * - expression / behavior / javascript / binding などの危険なワードを含むスタイル定義を除去
 * - url(javascript:...) などのスキームを除去
 * - html, body, :root などのグローバルセレクタを `.fn-custom-page` 内にスコープ制限
 */
export function sanitizeUserCss(css: string | null | undefined): string {
  if (!css) return "";

  let cleaned = css;

  // 1. @import を削除 (大文字小文字、複数スペース含む)
  cleaned = cleaned.replace(/@import\s+[^;]+;/gi, "");

  // 2. 危険な表現を削除
  cleaned = cleaned.replace(/expression\s*\([^)]*\)/gi, "");
  cleaned = cleaned.replace(/behavior\s*:[^;}]*/gi, "");
  cleaned = cleaned.replace(/binding\s*:[^;}]*/gi, "");
  cleaned = cleaned.replace(/javascript\s*:[^;}]*/gi, "");

  // 3. url() 内の危険なスキームを除去/置換 (javascript: や data: など)
  // url("javascript:...") や url('javascript:...') url(javascript:...)
  cleaned = cleaned.replace(/url\s*\(\s*(['"]?)\s*(javascript|data|vbscript):/gi, "url($1about:blank");

  // 4. セレクタの制限 (html, body, :root などのグローバルセレクタを .fn-custom-page に置換/スコープ)
  // 単純な置換：セレクタ部分の html -> .fn-custom-page, body -> .fn-custom-page, :root -> .fn-custom-page
  cleaned = cleaned.replace(/(?:^|[{};,]\s*)(html|body|:root)(?=\s*[,{:\s])/gi, (match, p1) => {
    return match.replace(p1, ".fn-custom-page");
  });

  return cleaned;
}
