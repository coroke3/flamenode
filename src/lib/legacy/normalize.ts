import { normalizeHttpUrl } from "../utils/url.ts";
import { looksLikeMojibake } from "../utils/mojibake.ts";
import { extractYoutubeId } from "../youtube/id.ts";
import type { EventVisibilityStatus } from "../utils/eventStatusCore.ts";
import {
  type LegacyImportMode,
  resolveImportedEventState,
} from "./importState.ts";

const X_ID_MAX_LEN = 64;

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
  return normalizeHttpUrl(u, { maxLength: 1000 });
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
  return normalizeHttpUrl(cleanLegacyString(value), { maxLength: 1000 });
}

export function normalizeXId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^@+/, "").replace(/\s+/g, "_");
  if (!s) return null;
  if (!/^[A-Za-z0-9_]+$/.test(s)) return null;
  if (s.length > X_ID_MAX_LEN) s = s.slice(0, X_ID_MAX_LEN);
  return s.toLowerCase();
}

export function splitCsvString(s: string | null | undefined): string[] {
  return splitCsvStringPreserveEmpty(s).filter(Boolean);
}

export function splitCsvStringPreserveEmpty(
  s: string | null | undefined,
): string[] {
  if (!s) return [];
  const parts = String(s)
    .split(/[,\u3001]/)
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
  if (
    s.includes("collab") ||
    s.includes("複数") ||
    s.includes("合作") ||
    s.includes("団体") ||
    s.includes("隍") ||
    s.includes("蝗")
  ) {
    return "collab";
  }
  return "individual";
}

export function submissionTypeFromLegacyVideo(row: {
  type2?: string;
  type?: string;
  type1?: string;
}): "individual" | "collab" {
  return normalizeSubmissionType(row.type2 || row.type || row.type1);
}

export type LegacyXUserRow = {
  id: string;
  x_name: string;
  profile_text?: string | null;
  portfolio_contact?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
};

export interface LegacyEventInput {
  eventid?: string;
  eventname?: string;
  type?: string;
  start?: string;
  end?: string | null;
  icon?: string;
  img?: string;
  explanation?: string;
  member?: string;
  memberid?: string;
  menberpost?: string;
  memberpost?: string;
}

export interface LegacyEventEditor {
  x_user_id: string;
  x_name: string | null;
  public_role_label: string | null;
  is_public: 0 | 1;
  is_representative_candidate: boolean;
}

export interface LegacyEventResult {
  ok: boolean;
  warnings: string[];
  event?: {
    id: string;
    title: string;
    event_type: "event" | "collabo" | "type" | "other";
    explanation: string | null;
    icon_url: string | null;
    img_url: string | null;
    start_time: number | null;
    end_time: number | null;
    visibility_status: EventVisibilityStatus;
    is_active: 0 | 1;
    is_entry_open: 0 | 1;
    is_archived: 0 | 1;
    representative_x_user_id: string | null;
  };
  editors: LegacyEventEditor[];
  xUsers: LegacyXUserRow[];
}

const REPRESENTATIVE_HINT_REGEX = new RegExp(
  [
    "主催",
    "代表",
    "運営",
    "統括",
    String.fromCodePoint(0x8373, 0xff7b),
    String.fromCodePoint(0x8389, 0xff63),
    String.fromCodePoint(0x9a55, 0x53e5, 0x9727),
    String.fromCodePoint(0x90a8, 0xff71),
  ].join("|"),
);

export function normalizeEventInfo(
  input: LegacyEventInput,
  options: {
    importMode?: LegacyImportMode;
    now?: number;
  } = {},
): LegacyEventResult {
  const warnings: string[] = [];
  const eventid = (input.eventid ?? "").toString().trim().replace(/^@+/, "");
  if (!eventid) {
    return { ok: false, warnings: ["eventid が空です。"], editors: [], xUsers: [] };
  }

  const title = cleanLegacyString(input.eventname) ?? "";
  if (!title) warnings.push("eventname が空です。");
  if (looksLikeMojibake(title)) warnings.push("eventname に文字化けの疑いがあります。");

  const startTime = toUnixSec(input.start ?? null);
  const endTime = input.end ? toUnixSec(input.end) : null;
  if (input.start && startTime == null) warnings.push("start を日時として解析できませんでした。");
  if (input.end && endTime == null && input.end !== "") {
    warnings.push("end を日時として解析できませんでした。");
  }

  const names = splitCsvStringPreserveEmpty(input.member);
  const ids = splitCsvStringPreserveEmpty(input.memberid);
  const posts = splitCsvStringPreserveEmpty(input.memberpost ?? input.menberpost);
  const len = Math.max(names.length, ids.length, posts.length);

  const editors: LegacyEventEditor[] = [];
  const xUsersMap = new Map<string, LegacyXUserRow>();
  let representativeId: string | null = null;

  for (let i = 0; i < len; i++) {
    const name = cleanLegacyString(names[i]) ?? "";
    const rawId = ids[i] ?? "";
    const post = cleanLegacyString(posts[i]) ?? "";
    const xid = normalizeXId(rawId);
    if (!xid) {
      if (rawId) warnings.push(`memberid「${rawId}」を X ID として解析できませんでした。`);
      continue;
    }
    const isRep = REPRESENTATIVE_HINT_REGEX.test(post);
    if (isRep && !representativeId) representativeId = xid;
    editors.push({
      x_user_id: xid,
      x_name: name || null,
      public_role_label: post || null,
      is_public: post ? 1 : 0,
      is_representative_candidate: isRep,
    });
    if (!xUsersMap.has(xid)) {
      xUsersMap.set(xid, { id: xid, x_name: name || `@${xid}` });
    }
  }

  if (!representativeId && editors.length > 0) {
    representativeId = editors[0].x_user_id;
  }

  const state = resolveImportedEventState({
    mode: options.importMode ?? "archive",
    startTime,
    endTime,
    now: options.now ?? Math.floor(Date.now() / 1000),
  });

  return {
    ok: true,
    warnings,
    event: {
      id: eventid,
      title: title || eventid,
      event_type: normalizeEventType(input.type),
      explanation: cleanLegacyString(input.explanation),
      icon_url: normalizeIconUrl(input.icon),
      img_url: normalizeIconUrl(input.img),
      start_time: startTime,
      end_time: endTime,
      visibility_status: state.visibility_status,
      is_active: state.is_active,
      is_entry_open: state.is_entry_open,
      is_archived: state.is_archived,
      representative_x_user_id: representativeId,
    },
    editors,
    xUsers: Array.from(xUsersMap.values()),
  };
}

export interface LegacyVideoInput {
  eventid?: string;
  title?: string;
  creator?: string;
  yomi?: string;
  tlink?: string;
  ychlink?: string;
  type?: string;
  type2?: string;
  icon?: string;
  ylink?: string;
  ymulink?: string;
  music?: string;
  credit?: string;
  comment?: string;
  beforecomment?: string;
  aftercomment?: string;
  soft?: string;
  hitokoto?: string;
  ycomment?: string;
  righttype?: string;
  toudan?: string;
  othersns?: string;
  type1?: string;
  movieyear?: string;
  data?: string;
  time?: string;
  timestamp?: string | number;
  member?: string;
  memberid?: string;
  starts?: string | number[];
  ends?: string | number[];
}

export interface LegacyVideoMember {
  x_user_id: string | null;
  name: string;
  role: string | null;
  order_index: number;
}

export interface LegacyVideoResult {
  ok: boolean;
  warnings: string[];
  video?: {
    id: string;
    title: string;
    display_name: string;
    display_name_yomi: string | null;
    creator_x_user_id: string | null;
    icon_url: string | null;
    youtube_video_id: string | null;
    music: string | null;
    credit: string | null;
    music_reference_url: string | null;
    intro_comment: string | null;
    closing_comment: string | null;
    used_software: string | null;
    highlights: string | null;
    stage_permission: string | null;
    submission_type: "individual" | "collab";
    primary_event_id: string | null;
    scheduling_type: "slotted" | "manual";
    scheduled_time: number | null;
    created_at: number | null;
    status: "public";
  };
  members: LegacyVideoMember[];
  xUsers: LegacyXUserRow[];
  eventId: string | null;
  eventIds: string[];
}

export function normalizeLegacyVideo(
  input: LegacyVideoInput,
): LegacyVideoResult {
  const warnings: string[] = [];
  const looseRow = input as Record<string, unknown>;

  const title = cleanLegacyString(input.title) ?? "";
  const creator = cleanLegacyString(input.creator) ?? "";
  const tlink = normalizeXId(input.tlink);
  if (!tlink) warnings.push(`tlink「${input.tlink ?? ""}」が空、または不正な X ID です。`);
  if (looksLikeMojibake(title)) warnings.push("title に文字化けの疑いがあります。");

  const ylink = input.ylink ?? null;
  const youtubeId = ylink ? extractYoutubeId(ylink) : null;
  if (ylink && !youtubeId) warnings.push("ylink から YouTube ID を抽出できませんでした。");

  const eventStartYear =
    input.timestamp && typeof input.timestamp === "string"
      ? new Date(input.timestamp).getUTCFullYear() || undefined
      : undefined;
  const scheduled = toUnixSec(input.time ?? input.data ?? null, eventStartYear, input.time);
  const created = toUnixSec(input.timestamp ?? null);

  let intro = cleanLegacyString(input.comment) ?? "";
  if (!intro && input.beforecomment) intro = cleanLegacyString(input.beforecomment) ?? "";

  const highlightsParts = [
    cleanLegacyString(input.hitokoto),
    cleanLegacyString(input.ycomment),
  ].filter((s): s is string => !!s);
  const highlights = highlightsParts.length > 0 ? highlightsParts.join("\n") : null;

  const toudan = cleanLegacyString(input.toudan);
  const otherSns = normalizeLegacyUrl(input.othersns) ?? cleanLegacyString(input.othersns);
  if (toudan) {
    warnings.push("toudan は videos.custom_answers 廃止のため取り込みません。");
  }
  if ("" in looseRow && looseRow[""] != null && String(looseRow[""]).trim() !== "") {
    const meta = cleanLegacyString(looseRow[""]);
    if (meta) {
      warnings.push(
        "旧エクスポートメタデータは videos.custom_answers 廃止のため取り込みません。",
      );
    }
  }
  const declaredExperience = cleanLegacyString(input.movieyear);
  if (declaredExperience) {
    warnings.push(
      "movieyear は videos.custom_answers 廃止のため取り込みません。",
    );
  }

  const submission_type = submissionTypeFromLegacyVideo({
    type2: input.type2,
    type: input.type,
    type1: input.type1,
  });

  const names = splitCsvStringPreserveEmpty(input.member);
  const ids = splitCsvStringPreserveEmpty(input.memberid);
  const memberCount = Math.max(names.length, ids.length);
  const members: LegacyVideoMember[] = [];
  const xUsersMap = new Map<string, LegacyXUserRow>();
  const youtubeChannelUrl = normalizeLegacyUrl(input.ychlink);

  if (tlink) {
    xUsersMap.set(tlink, {
      id: tlink,
      x_name: creator || `@${tlink}`,
      youtube_channel_url: youtubeChannelUrl,
      portfolio_contact: null,
      other_social_links: otherSns,
    });
  }

  for (let i = 0; i < memberCount; i++) {
    const name = cleanLegacyString(names[i]) ?? "";
    const rawId = (ids[i] ?? "").trim();
    const xid = normalizeXId(rawId);
    if (rawId && !xid) {
      warnings.push(`memberid「${rawId}」を X ID として解釈できませんでした。`);
    }
    if (!name && !xid) continue;
    members.push({
      x_user_id: xid,
      name: name || (xid ? `@${xid}` : ""),
      role: null,
      order_index: i,
    });
    if (xid && !xUsersMap.has(xid)) {
      xUsersMap.set(xid, {
        id: xid,
        x_name: name || `@${xid}`,
        youtube_channel_url: null,
        portfolio_contact: null,
        other_social_links: null,
      });
    }
  }

  if (names.length !== ids.length && (names.length > 0 || ids.length > 0)) {
    warnings.push("member と memberid の件数が一致しません。存在する組み合わせだけ取り込みます。");
  }

  if (!tlink && !title) {
    return { ok: false, warnings, members: [], xUsers: [], eventId: null, eventIds: [] };
  }

  const id = youtubeId ? `legacy_${youtubeId}` : `legacy_${randomId()}`;
  const eventIds = splitLegacyEventIds(input.eventid);
  const eventId = eventIds[0] ?? null;
  if ((input.eventid ?? "").toString().trim() && eventIds.length === 0) {
    warnings.push("eventid をイベントIDとして解釈できませんでした。");
  }

  return {
    ok: true,
    warnings,
    video: {
      id,
      title: title || `(無題) ${youtubeId ?? id}`,
      display_name: creator || (tlink ? `@${tlink}` : "anonymous"),
      display_name_yomi: cleanLegacyString(input.yomi),
      creator_x_user_id: tlink,
      icon_url: normalizeIconUrl(input.icon),
      youtube_video_id: youtubeId,
      music: cleanLegacyString(input.music),
      credit: cleanLegacyString(input.credit),
      music_reference_url: normalizeLegacyUrl(input.ymulink),
      intro_comment: intro || null,
      closing_comment: cleanLegacyString(input.aftercomment),
      used_software: cleanLegacyString(input.soft),
      highlights,
      stage_permission: cleanLegacyString(input.righttype),
      submission_type: members.length > 0 ? "collab" : submission_type,
      primary_event_id: eventId,
      scheduling_type: "manual",
      scheduled_time: scheduled,
      created_at: created ?? scheduled,
      status: "public",
    },
    members,
    xUsers: Array.from(xUsersMap.values()),
    eventId,
    eventIds,
  };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
