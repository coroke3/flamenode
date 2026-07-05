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
    u.match(/drive\.google\.com\/thumbnail\?id=([A-Za-z0-9_-]+)/) ||
    u.match(/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/);
  if (m?.[1]) return `/api/google-drive-image/${m[1]}`;
  if (u.startsWith("/api/media/") || u.startsWith("/api/google-drive-image/")) return u;
  return normalizeHttpUrlCore(u);
}

export function cleanLegacyString(
  value: unknown,
  options: { maxLength?: number } = {},
): string | null {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;
  const maxLength = options.maxLength;
  if (maxLength && cleaned.length > maxLength) return cleaned.slice(0, maxLength);
  return cleaned;
}

export function normalizeLegacyUrl(
  value: string | null | undefined,
): string | null {
  return normalizeHttpUrlCore(cleanLegacyString(value), 1000);
}

function normalizeHttpUrlCore(
  raw: string | null | undefined,
  maxLength = 1000,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > maxLength) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
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
  return splitCsvStringPreserveEmpty(s).filter(Boolean);
}

export function splitCsvStringPreserveEmpty(
  s: string | null | undefined,
): string[] {
  if (!s) return [];
  const parts = String(s)
    .split(CSV_SPLIT_RE)
    .map((x) => x.trim());
  while (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

export function splitLegacyEventIds(
  raw: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of splitCsvString(raw).map((s) => s.replace(/^@+/, ""))) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

export type LegacyKind = "events" | "videos" | "unknown";

export function detectLegacyKind(value: unknown): LegacyKind {
  if (!Array.isArray(value) || value.length === 0) return "unknown";
  const head = value[0] as Record<string, unknown> | undefined;
  if (!head || typeof head !== "object") return "unknown";
  if ("eventid" in head && ("eventname" in head || "start" in head)) {
    if ("ylink" in head || "tlink" in head || "creator" in head) return "videos";
    return "events";
  }
  if ("ylink" in head || "tlink" in head || "creator" in head || "type2" in head) {
    return "videos";
  }
  return "unknown";
}

// Re-export for test convenience
export { MOJIBAKE_TOKENS, COLLAB_TOKENS, X_ID_MAX_LEN };
