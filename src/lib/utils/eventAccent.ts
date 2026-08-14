import type { CSSProperties } from "react";

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** manage 画面でイベント accent_color を CSS 変数に載せる */
export function manageEventAccentStyle(
  accentColor: string | null | undefined,
): CSSProperties | undefined {
  const color = accentColor?.trim();
  // DBに古い値や手入力のCSS断片が残っていても、CSS変数の宣言全体を
  // 壊さず安全に既定色へ戻す。入力UIの正本はhexカラー。
  if (!color || !HEX_COLOR_RE.test(color)) return undefined;
  return { "--manage-event-accent": color } as CSSProperties;
}
