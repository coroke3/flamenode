export const THEME_STORAGE_KEY = "fn-theme";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** 古い保存値や破損値を安全に system へ戻す。 */
export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/** OS の色設定を受けて、DOM に適用する実テーマを返す。 */
export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark ? "dark" : "light";
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === "system") return "light";
  if (mode === "light") return "dark";
  return "system";
}
