/**
 * ユーザー入力 HTML を Custom Page で表示する前に通すサニタイザ。
 *
 * 完全な DOMPurify ではないため過信しないこと。最低限の防御として:
 *   - script / iframe / object / embed / form / meta / base / link / style 開始タグを削除
 *   - 上記要素内のテキストも閉じタグまでまるごと削除
 *   - on... イベントハンドラ属性を削除
 *   - href / src 属性内の javascript: スキームを削除
 *   - data: URL は image/* 以外を削除
 *
 * 大量の表現を許容しつつ XSS の代表的なベクタを潰す方針。
 * より厳密に絞りたい場合は allowlist 方式へ差し替える。
 */
export function sanitizeUserHtml(input: string | null | undefined): string {
  if (!input) return "";
  let html = input;

  // ブロックタグごと中身を削除 (大文字小文字混在を考慮)
  const dangerousTags = [
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "meta",
    "base",
    "link",
    "style",
  ];
  for (const tag of dangerousTags) {
    const blockRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    html = html.replace(blockRe, "");
    // 自己閉じや閉じタグ単独
    const openRe = new RegExp(`<${tag}\\b[^>]*\\/?\\s*>`, "gi");
    html = html.replace(openRe, "");
    const closeRe = new RegExp(`<\\/${tag}\\s*>`, "gi");
    html = html.replace(closeRe, "");
  }

  // on... イベントハンドラ属性 (on click="..." / on click='...' / on click=value)
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // style 属性を削除
  html = html.replace(/\sstyle\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\sstyle\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\sstyle\s*=\s*[^\s>]+/gi, "");

  // javascript: スキーム
  html = html.replace(
    /(href|src|xlink:href|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi,
    "$1=$2#$2",
  );
  html = html.replace(/(href|src|formaction)\s*=\s*javascript:[^\s>]+/gi, "$1=#");

  // data: URL は png/jpeg/gif/webp のみに限定 (svg+xml は除外)
  html = html.replace(
    /(href|src)\s*=\s*(["'])\s*data:(?!image\/(png|jpeg|gif|webp)\b)[^"']*\2/gi,
    "$1=$2#$2",
  );

  return html;
}
