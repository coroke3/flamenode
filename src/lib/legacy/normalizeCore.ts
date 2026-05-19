/**
 * legacy import pure helpers (no path alias deps).
 * Mirrors normalize.ts exactly. Constants use String.fromCodePoint
 * to avoid file-encoding issues when this file is rewritten by tools.
 *
 * Token verification:
 *   MOJIBAKE codepoints: fffd,7e3a,7e67,8373,8b41,90b5,965e,9677,95d5,96b4
 *   COLLAB codepoints:   8907+6570, 5408+4f5c, 56e3+4f53, 968d, 8757
 */

const MOJIBAKE_TOKENS: string[] = [
  String.fromCodePoint(0xfffd),
  String.fromCodePoint(0x7e3a),
  String.fromCodePoint(0x7e67),
  String.fromCodePoint(0x8373),
  String.fromCodePoint(0x8b41),
  String.fromCodePoint(0x90b5),
  String.fromCodePoint(0x965e),
  String.fromCodePoint(0x9677),
  String.fromCodePoint(0x95d5),
  String.fromCodePoint(0x96b4),
];

const COLLAB_TOKENS: string[] = [
  "collab",
  String.fromCodePoint(0x8907, 0x6570),
  String.fromCodePoint(0x5408, 0x4f5c),
  String.fromCodePoint(0x56e3, 0x4f53),
  String.fromCodePoint(0x968d),
  String.fromCodePoint(0x8757),
];

const X_ID_MAX_LEN = 64;

export function looksLikeMojibake(s: string | null | undefined): boolean {
  if (!s) return false;
  if (MOJIBAKE_TOKENS.some((t) => s.includes(t))) return true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x00 && c <= 0x08) || (c >= 0x0b && c <= 0x1f)) return true;
  }
  return false;
}

export function normalizeIconUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  const m =
    u.match(/drive\.google\.com\/(?:open|uc)\?[^#]*[?&]?id=([A-Za-z0-9_-]+)/) ||
    u.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) ||
    u.match(/drive\.google\.com\/thumbnail\?id=([A-Za-z0-9_-]+)/);
  if (m?.[1]) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  return u;
}

export function normalizeXIdLegacy(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^@+/, "").replace(/\s+/g, "_");
  if (!s) return null;
  if (!/^[A-Za-z0-9_]+$/.test(s)) return null;
  if (s.length > X_ID_MAX_LEN) s = s.slice(0, X_ID_MAX_LEN);
  return s.toLowerCase();
}

// Match split chars: ASCII comma and JP comma (U+3001)
const CSV_SPLIT_RE = new RegExp(`[,${String.fromCodePoint(0x3001)}]`);

export function splitCsvString(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .split(CSV_SPLIT_RE)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function toUnixSec(
  value: string | number | null | undefined,
  fallbackYear?: number,
  timePart?: string | null,
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (value > 1e6 && value < 1e11) return Math.floor(value);
    if (value > 1e12) return Math.floor(value / 1000);
    if (value > 1 && value < 60000) {
      const ms = (value - 25569) * 86400 * 1000;
      return Math.floor(ms / 1000);
    }
    return null;
  }

  const s = String(value).trim();
  if (!s) return null;
  const asNumber = Number(s);
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(s)) {
    return toUnixSec(asNumber);
  }
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return Math.floor(iso / 1000);

  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md && fallbackYear) {
    const [, mm, dd] = md;
    const t = timePart && /^\d{1,2}:\d{2}/.test(timePart) ? timePart : "00:00";
    const d = Date.parse(
      `${fallbackYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${t}:00+09:00`,
    );
    if (!Number.isNaN(d)) return Math.floor(d / 1000);
  }
  return null;
}

export function normalizeEventType(
  raw: string | null | undefined,
): "event" | "collabo" | "type" | "other" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s === "event") return "event";
  if (s === "collabo" || s === "collab" || s === "collaboration") return "collabo";
  if (s === "type") return "type";
  if (!s) return "event";
  return "other";
}

export function normalizeSubmissionType(
  raw: string | null | undefined,
): "individual" | "collab" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return "individual";
  if (COLLAB_TOKENS.some((t) => s.includes(t))) return "collab";
  return "individual";
}

export function submissionTypeFromLegacyVideo(row: {
  type2?: string;
  type?: string;
  type1?: string;
}): "individual" | "collab" {
  return normalizeSubmissionType(row.type2 || row.type || row.type1);
}

// Re-export for test convenience
export { MOJIBAKE_TOKENS, COLLAB_TOKENS, X_ID_MAX_LEN };
