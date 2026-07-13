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

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseLegacyClock(
  value: string | null | undefined,
): { hour: number; minute: number; second: number } | null {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return { hour, minute, second };
}

function buildJstUnixSec(args: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}): number | null {
  const {
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
  } = args;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const utcMs = Date.UTC(
    year,
    month - 1,
    day,
    hour - 9,
    minute,
    second,
    0,
  );

  const jstView = new Date(utcMs + JST_OFFSET_MS);

  if (
    jstView.getUTCFullYear() !== year ||
    jstView.getUTCMonth() + 1 !== month ||
    jstView.getUTCDate() !== day ||
    jstView.getUTCHours() !== hour ||
    jstView.getUTCMinutes() !== minute ||
    jstView.getUTCSeconds() !== second
  ) {
    return null;
  }

  return Math.floor(utcMs / 1000);
}

function parseLegacyDateParts(
  value: string,
  fallbackYear?: number,
): { year: number; month: number; day: number } | null {
  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return {
      year: Number(ymd[1]),
      month: Number(ymd[2]),
      day: Number(ymd[3]),
    };
  }

  const md = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md && fallbackYear) {
    return {
      year: fallbackYear,
      month: Number(md[1]),
      day: Number(md[2]),
    };
  }

  return null;
}

function parseLegacyFullDateTime(value: string): number | null {
  const match = value.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) return null;

  return buildJstUnixSec({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  });
}

export function toUnixSec(
  value: string | number | null | undefined,
  fallbackYear?: number,
  timePart?: string | null,
): number | null {
  if (value == null || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;

    if (value > 1e6 && value < 1e11) {
      return Math.floor(value);
    }

    if (value > 1e12) {
      return Math.floor(value / 1000);
    }

    // Excel / Google Sheets serial date
    if (value > 1 && value < 60000) {
      return Math.floor((value - 25569) * 86400);
    }

    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return toUnixSec(Number(raw));
  }

  const dateParts = parseLegacyDateParts(raw, fallbackYear);
  if (dateParts) {
    const trimmedTime = String(timePart ?? "").trim();
    if (trimmedTime) {
      const clock = parseLegacyClock(trimmedTime);
      if (!clock) return null;
      return buildJstUnixSec({
        ...dateParts,
        ...clock,
      });
    }

    return buildJstUnixSec(dateParts);
  }

  const legacyFull = parseLegacyFullDateTime(raw);
  if (legacyFull !== null) return legacyFull;

  // タイムゾーンを含むISO日時など
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

export function legacyYearFromTimestamp(
  value: string | number | null | undefined,
): number | undefined {
  const unixSec = toUnixSec(value);
  if (unixSec === null) return undefined;

  return new Date(unixSec * 1000 + JST_OFFSET_MS).getUTCFullYear();
}

export function resolveLegacyScheduledTime(args: {
  date?: string | null;
  time?: string | null;
  timestamp?: string | number | null;
  fallbackYear?: number;
}): number | null {
  const date = cleanLegacyString(args.date);
  const time = cleanLegacyString(args.time);

  // time列自体に完全な日時が格納されている場合
  if (time && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T\s]/.test(time)) {
    const parsed = toUnixSec(time);
    if (parsed !== null) return parsed;
  }

  const year =
    args.fallbackYear ??
    legacyYearFromTimestamp(args.timestamp);

  if (!date) return null;

  return toUnixSec(date, year, time);
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
