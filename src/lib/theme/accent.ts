/**
 * イベントのアクセントカラーを CSS 変数のセットに正規化する。
 *
 * 元の `event.accent_color` (hex) はライト/ダークどちらのテーマでも自然に
 * 馴染むよう、HSL に変換した上で輝度をクランプして調整する。
 * 出てくる変数:
 *   - `--event-accent`        主アクセント (テキスト・線・小さなアイコン)
 *   - `--event-accent-strong` ホバー / 強調用 (主アクセントより少し濃い/明るい)
 *   - `--event-accent-soft`   背面塗り用 (透明寄り)
 *   - `--event-accent-text`   アクセント上に乗せる文字色 (#0c0f14 か #fff)
 *   - `--event-accent-ring`   フォーカスリング / 枠線 (半透明)
 *
 * `--event-accent` 系を CSS で利用する際は `var(--event-accent, var(--accent-primary))`
 * のようにフォールバックを必ず指定すること (event_color が無い場合に対応)。
 */
import type * as React from "react";

const DEFAULT_HEX = "#ffd400";

type Hsl = { h: number; s: number; l: number };

function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  const hex = m[1]!;
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((c) => c + c)
      .join("")}`.toLowerCase();
  }
  return `#${hex.toLowerCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function clampLightness(hsl: Hsl, minL: number, maxL: number): Hsl {
  return { ...hsl, l: Math.min(maxL, Math.max(minL, hsl.l)) };
}

function hslToCss({ h, s, l }: Hsl): string {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

/** L が低い (=暗い) と白文字、L が高いと黒文字を返す。 */
function pickReadableText({ l }: Hsl, theme: "light" | "dark"): string {
  // ダークテーマで暗い背景に明るいアクセントが乗るケースは黒文字寄り、
  // ライトテーマで明るい背景に暗いアクセントが乗るケースは白文字寄り。
  if (theme === "dark") return l >= 60 ? "#0c0f14" : "#f8fafc";
  return l <= 55 ? "#f8fafc" : "#0c0f14";
}

export function buildAccentVars(
  hex: string | null | undefined,
  theme: "light" | "dark" = "dark",
): React.CSSProperties {
  const safe = normalizeHex(hex) ?? DEFAULT_HEX;
  const baseHsl = rgbToHsl(hexToRgb(safe));
  const adjusted =
    theme === "dark"
      ? clampLightness(baseHsl, 62, 78)
      : clampLightness(baseHsl, 38, 58);
  const strong = clampLightness(
    { ...adjusted, l: theme === "dark" ? adjusted.l + 6 : adjusted.l - 6 },
    20,
    90,
  );
  const accentCss = hslToCss(adjusted);
  const strongCss = hslToCss(strong);
  return {
    ["--event-accent" as never]: accentCss,
    ["--event-accent-strong" as never]: strongCss,
    ["--event-accent-soft" as never]:
      theme === "dark"
        ? `color-mix(in srgb, ${accentCss} 24%, transparent)`
        : `color-mix(in srgb, ${accentCss} 16%, transparent)`,
    ["--event-accent-text" as never]: pickReadableText(adjusted, theme),
    ["--event-accent-ring" as never]: `color-mix(in srgb, ${accentCss} 50%, transparent)`,
  } as React.CSSProperties;
}

/** raw hex を直接受け取って妥当な値を返したい場合のヘルパー。 */
export function safeAccentHex(input: string | null | undefined): string {
  return normalizeHex(input) ?? DEFAULT_HEX;
}
