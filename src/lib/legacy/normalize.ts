import { extractYoutubeId } from "@/lib/youtube/id";

const MOJIBAKE_TOKENS = ["�", "縺", "繧", "荳", "譁", "邵", "陞", "陷", "闕", "隴"];
const X_ID_MAX_LEN = 64;

export function looksLikeMojibake(s: string | null | undefined): boolean {
  if (!s) return false;
  if (MOJIBAKE_TOKENS.some((t) => s.includes(t))) return true;
  return /[\u0000-\u0008\u000B-\u001F]/.test(s);
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

export function normalizeXId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^@+/, "").replace(/\s+/g, "_");
  if (!s) return null;
  if (!/^[A-Za-z0-9_]+$/.test(s)) return null;
  if (s.length > X_ID_MAX_LEN) s = s.slice(0, X_ID_MAX_LEN);
  return s;
}

export function splitCsvString(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .split(/[,\u3001]/)
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
  youtube_channel_url?: string | null;
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
    is_active: 0 | 1;
    is_entry_open: 0 | 1;
    is_archived: 0 | 1;
    representative_x_user_id: string | null;
  };
  editors: LegacyEventEditor[];
  xUsers: LegacyXUserRow[];
}

const REPRESENTATIVE_HINT_REGEX = /(主催|代表|運営|統括|荳ｻ|莉｣|驕句霧|邨ｱ)/;

export function normalizeEventInfo(
  input: LegacyEventInput,
): LegacyEventResult {
  const warnings: string[] = [];
  const eventid = (input.eventid ?? "").toString().trim().replace(/^@+/, "");
  if (!eventid) {
    return { ok: false, warnings: ["eventid が空です。"], editors: [], xUsers: [] };
  }

  const title = (input.eventname ?? "").toString().trim();
  if (!title) warnings.push("eventname が空です。");
  if (looksLikeMojibake(title)) warnings.push("eventname に文字化けの疑いがあります。");

  const startTime = toUnixSec(input.start ?? null);
  const endTime = input.end ? toUnixSec(input.end) : null;
  if (input.start && startTime == null) warnings.push("start を日時として解析できませんでした。");
  if (input.end && endTime == null && input.end !== "") {
    warnings.push("end を日時として解析できませんでした。");
  }

  const names = splitCsvString(input.member);
  const ids = splitCsvString(input.memberid);
  const posts = splitCsvString(input.memberpost ?? input.menberpost);
  const len = Math.max(names.length, ids.length, posts.length);

  const editors: LegacyEventEditor[] = [];
  const xUsersMap = new Map<string, LegacyXUserRow>();
  let representativeId: string | null = null;

  for (let i = 0; i < len; i++) {
    const name = names[i] ?? "";
    const rawId = ids[i] ?? "";
    const post = posts[i] ?? "";
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

  return {
    ok: true,
    warnings,
    event: {
      id: eventid,
      title: title || eventid,
      event_type: normalizeEventType(input.type),
      explanation: input.explanation ? String(input.explanation) : null,
      icon_url: normalizeIconUrl(input.icon),
      img_url: normalizeIconUrl(input.img),
      start_time: startTime,
      end_time: endTime,
      is_active: 1,
      is_entry_open: 0,
      is_archived: 0,
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
    contact_x_id: string;
    creator_id: string | null;
    icon_url: string | null;
    youtube_video_id: string | null;
    music: string | null;
    credit: string | null;
    music_reference_url: string | null;
    intro_comment: string | null;
    closing_comment: string | null;
    used_software: string | null;
    highlights: string | null;
    custom_answers: string | null;
    stage_permission: string | null;
    submission_type: "individual" | "collab";
    declared_experience: string | null;
    primary_event_id: string | null;
    scheduling_type: "slotted" | "manual";
    scheduled_time: number | null;
    created_at: number | null;
    status: "public";
  };
  members: LegacyVideoMember[];
  xUsers: LegacyXUserRow[];
  eventId: string | null;
}

export function normalizeLegacyVideo(
  input: LegacyVideoInput,
): LegacyVideoResult {
  const warnings: string[] = [];
  const looseRow = input as Record<string, unknown>;

  const title = (input.title ?? "").toString().trim();
  const creator = (input.creator ?? "").toString().trim();
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

  let intro = (input.comment ?? "").toString().trim();
  if (!intro && input.beforecomment) intro = input.beforecomment.toString();

  const highlightsParts = [
    input.hitokoto?.toString().trim(),
    input.ycomment?.toString().trim(),
  ].filter((s): s is string => !!s);
  const highlights = highlightsParts.length > 0 ? highlightsParts.join("\n") : null;

  const customObj: Record<string, string> = {};
  if (input.toudan) customObj.toudan = String(input.toudan);
  if (input.othersns) customObj.othersns = String(input.othersns);
  if ("" in looseRow && looseRow[""] != null && String(looseRow[""]).trim() !== "") {
    customObj.legacy_export_meta = String(looseRow[""]);
  }
  const custom_answers = Object.keys(customObj).length > 0 ? JSON.stringify(customObj) : null;

  const submission_type = submissionTypeFromLegacyVideo({
    type2: input.type2,
    type: input.type,
    type1: input.type1,
  });

  const names = splitCsvString(input.member);
  const ids = splitCsvString(input.memberid);
  const memberCount = Math.max(names.length, ids.length);
  const members: LegacyVideoMember[] = [];
  const xUsersMap = new Map<string, LegacyXUserRow>();
  const ychTrim = input.ychlink ? String(input.ychlink).trim() : "";

  if (tlink) {
    xUsersMap.set(tlink, {
      id: tlink,
      x_name: creator || `@${tlink}`,
      youtube_channel_url: ychTrim || null,
    });
  }

  for (let i = 0; i < memberCount; i++) {
    const name = (names[i] ?? "").trim();
    const xid = normalizeXId(ids[i]);
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
      });
    }
  }

  if (names.length !== ids.length && (names.length > 0 || ids.length > 0)) {
    warnings.push("member と memberid の件数が一致しません。存在する組み合わせだけ取り込みます。");
  }

  if (!tlink && !title) {
    return { ok: false, warnings, members: [], xUsers: [], eventId: null };
  }

  const id = youtubeId ? `legacy_${youtubeId}` : `legacy_${randomId()}`;
  const eventId = (input.eventid ?? "").toString().trim() || null;

  return {
    ok: true,
    warnings,
    video: {
      id,
      title: title || `(無題) ${youtubeId ?? id}`,
      display_name: creator || (tlink ? `@${tlink}` : "anonymous"),
      display_name_yomi: input.yomi ? String(input.yomi) : null,
      contact_x_id: tlink ?? "anonymous",
      creator_id: tlink,
      icon_url: normalizeIconUrl(input.icon),
      youtube_video_id: youtubeId,
      music: input.music ? String(input.music) : null,
      credit: input.credit ? String(input.credit) : null,
      music_reference_url: input.ymulink ? String(input.ymulink) : null,
      intro_comment: intro || null,
      closing_comment: input.aftercomment ? String(input.aftercomment) : null,
      used_software: input.soft ? String(input.soft) : null,
      highlights,
      custom_answers,
      stage_permission: input.righttype ? String(input.righttype) : null,
      submission_type,
      declared_experience: input.movieyear ? String(input.movieyear) : null,
      primary_event_id: eventId,
      scheduling_type: "manual",
      scheduled_time: scheduled,
      created_at: created ?? scheduled,
      status: "public",
    },
    members,
    xUsers: Array.from(xUsersMap.values()),
    eventId,
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
