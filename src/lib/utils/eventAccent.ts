import type { CSSProperties } from "react";

/** manage 画面でイベント accent_color を CSS 変数に載せる */
export function manageEventAccentStyle(
  accentColor: string | null | undefined,
): CSSProperties | undefined {
  const color = accentColor?.trim();
  if (!color) return undefined;
  return { "--manage-event-accent": color } as CSSProperties;
}
