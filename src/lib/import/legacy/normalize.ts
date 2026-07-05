/**
 * 旧 EventArchives JSON の正規化。
 *
 * DB canonical ルール準拠:
 * - events: is_active/is_entry_open/is_archived は出力しない
 * - videos: stage_permission / used_software_json カラムに書かない
 *   代わりに legacyCustomAnswers / softwareLabels として返す
 * - video_members: starts/ends から chapters_json を生成
 */

import {
  cleanLegacyString,
  detectLegacyKind,
  looksLikeMojibake,
  normalizeEventType,
  normalizeIconUrl,
  normalizeSubmissionType,
  normalizeXIdLegacy,
  normalizeLegacyUrl,
  splitCsvStringPreserveEmpty,
  splitLegacyEventIds,
  submissionTypeFromLegacyVideo,
  toUnixSec,
  type LegacyKind,
} from "./normalizeCore.ts";
import { resolveImportedVisibility } from "./importMode.ts";
import type { ImportMode } from "./types.ts";
import type { EventVisibilityStatus } from "../../utils/eventStatusCore.ts";

// ============================================================
// 再エクスポート
// ============================================================

export { detectLegacyKind };
export type { LegacyKind };

// ============================================================
// 入力型
// ============================================================

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

// ============================================================
// 出力型
// ============================================================

export type LegacyXUserRow = {
  id: string;
  x_name: string;
  profile_text?: string | null;
  portfolio_contact?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
};

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
    /** visibility_status のみ。is_active 等は出力しない */
    visibility_status: EventVisibilityStatus;
    representative_x_user_id: string | null;
  };
  editors: LegacyEventEditor[];
  xUsers: LegacyXUserRow[];
}

export interface LegacyVideoMember {
  x_user_id: string | null;
  name: string;
  role: string | null;
  order_index: number;
  chapters_json: string | null;
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
    creator_icon_url: string | null;
    youtube_video_id: string | null;
    music: string | null;
    credit: string | null;
    music_reference_url: string | null;
    intro_comment: string | null;
    closing_comment: string | null;
    highlights: string | null;
    submission_type: "individual" | "collab";
    primary_event_id: string | null;
    scheduling_type: "slotted" | "manual";
    scheduled_time: number | null;
    created_at: number | null;
    status: "public";
    /** video_softwares へ書き込むラベル */
    softwareLabels: string[];
    /** event_custom_questions/video_custom_answers へ書き込む旧メタ */
    legacyCustomAnswers: Array<{ key: string; value: string }>;
  };
  members: LegacyVideoMember[];
  xUsers: LegacyXUserRow[];
  eventId: string | null;
  eventIds: string[];
}

// ============================================================
// イベント正規化
// ============================================================

const REPRESENTATIVE_HINT_REGEX = new RegExp(
  [
    "\u4e3b\u50ac",
    "\u4ee3\u8868",
    "\u904b\u55b6",
    "\u7d71\u62ec",
    String.fromCodePoint(0x8373, 0xff7b),
    String.fromCodePoint(0x8389, 0xff63),
    String.fromCodePoint(0x9a55, 0x53e5, 0x9727),
    String.fromCodePoint(0x90a8, 0xff71),
  ].join("|"),
);

export function normalizeEventInfo(
  input: LegacyEventInput,
  options: { importMode?: ImportMode; now?: number } = {},
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
  if (input.start && startTime == null) {
    warnings.push("start を日時として解析できませんでした。");
  }
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
    const xid = normalizeXIdLegacy(rawId);
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

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const visibility_status = resolveImportedVisibility(
    options.importMode ?? "archive",
    startTime,
    endTime,
    now,
  );

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
      visibility_status,
      representative_x_user_id: representativeId,
    },
    editors,
    xUsers: Array.from(xUsersMap.values()),
  };
}

// ============================================================
// 動画正規化
// ============================================================

function parseTimeArray(raw: string | number[] | undefined): (number | null)[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    });
  }
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => {
      const n = Number(s.trim());
      return Number.isFinite(n) && n >= 0 ? n : null;
    });
}

function buildMemberChaptersJson(
  startSec: number | null,
  memberName: string,
  orderIndex: number,
): string | null {
  if (startSec == null) return null;
  const chapter = {
    time_seconds: startSec,
    label: memberName || "Chapter",
    note: "",
    order_index: orderIndex,
  };
  return JSON.stringify([chapter]);
}

function parseSoftwareLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\u3001\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeLegacyVideo(input: LegacyVideoInput): LegacyVideoResult {
  const warnings: string[] = [];
  const looseRow = input as Record<string, unknown>;

  const title = cleanLegacyString(input.title) ?? "";
  const creator = cleanLegacyString(input.creator) ?? "";
  const tlink = normalizeXIdLegacy(input.tlink);
  if (!tlink) {
    warnings.push(`tlink「${input.tlink ?? ""}」が空、または不正な X ID です。`);
  }
  if (looksLikeMojibake(title)) warnings.push("title に文字化けの疑いがあります。");

  const ylink = input.ylink ?? null;
  let youtubeId: string | null = null;
  if (ylink) {
    youtubeId = extractYoutubeIdSimple(ylink);
    if (!youtubeId) warnings.push("ylink から YouTube ID を抽出できませんでした。");
  }

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

  const youtubeChannelUrl = normalizeLegacyUrl(input.ychlink);
  const otherSns = normalizeLegacyUrl(input.othersns) ?? cleanLegacyString(input.othersns);

  // 旧フィールドを legacyCustomAnswers として収集 (stage_permission/used_software_json に書かない)
  const legacyCustomAnswers: Array<{ key: string; value: string }> = [];

  const righttype = cleanLegacyString(input.righttype);
  if (righttype) {
    legacyCustomAnswers.push({ key: "stage_permission", value: righttype });
  }

  const toudan = cleanLegacyString(input.toudan);
  if (toudan) {
    legacyCustomAnswers.push({ key: "stage_participation", value: toudan });
  }

  const movieyear = cleanLegacyString(input.movieyear);
  if (movieyear) {
    legacyCustomAnswers.push({ key: "production_experience", value: movieyear });
  }

  // 空キー旧メタ
  if ("" in looseRow && looseRow[""] != null && String(looseRow[""]).trim() !== "") {
    warnings.push("旧エクスポートメタデータ（空キー列）は取り込みません。");
  }

  // 使用ソフト → softwareLabels (video_softwares テーブルへ)
  const softwareLabels = parseSoftwareLabels(cleanLegacyString(input.soft));

  const submission_type = submissionTypeFromLegacyVideo({
    type2: input.type2,
    type: input.type,
    type1: input.type1,
  });

  const names = splitCsvStringPreserveEmpty(input.member);
  const ids = splitCsvStringPreserveEmpty(input.memberid);
  const memberCount = Math.max(names.length, ids.length);

  // starts/ends パース
  const startsArr = parseTimeArray(input.starts);
  const endsArr = parseTimeArray(input.ends);
  if (
    (startsArr.length > 0 || endsArr.length > 0) &&
    startsArr.length !== memberCount &&
    memberCount > 0
  ) {
    warnings.push(
      "starts/ends の要素数がメンバー数と一致しません。チャプターは一致する範囲のみ設定します。",
    );
  }

  const members: LegacyVideoMember[] = [];
  const xUsersMap = new Map<string, LegacyXUserRow>();

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
    const xid = normalizeXIdLegacy(rawId);
    if (rawId && !xid) {
      warnings.push(`memberid「${rawId}」を X ID として解釈できませんでした。`);
    }
    if (!name && !xid) continue;

    const startSec = startsArr[i] ?? null;
    const chaptersJson = buildMemberChaptersJson(startSec, name || (xid ? `@${xid}` : ""), 0);
    if (startsArr.length > 0 && startSec == null) {
      warnings.push(`member[${i}] の starts が数値として解析できませんでした。`);
    }

    members.push({
      x_user_id: xid,
      name: name || (xid ? `@${xid}` : ""),
      role: null,
      order_index: i,
      chapters_json: chaptersJson,
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
      creator_icon_url: normalizeIconUrl(input.icon),
      youtube_video_id: youtubeId,
      music: cleanLegacyString(input.music),
      credit: cleanLegacyString(input.credit),
      music_reference_url: normalizeLegacyUrl(input.ymulink),
      intro_comment: intro || null,
      closing_comment: cleanLegacyString(input.aftercomment),
      highlights,
      submission_type: members.length > 1 ? "collab" : submission_type,
      primary_event_id: eventId,
      scheduling_type: "manual",
      scheduled_time: scheduled,
      created_at: created ?? scheduled,
      status: "public",
      softwareLabels,
      legacyCustomAnswers,
    },
    members,
    xUsers: Array.from(xUsersMap.values()),
    eventId,
    eventIds,
  };
}

// ============================================================
// 内部ヘルパ
// ============================================================

function extractYoutubeIdSimple(url: string): string | null {
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// normalizeCore re-exports for convenience
export {
  cleanLegacyString,
  looksLikeMojibake,
  normalizeEventType,
  normalizeIconUrl,
  normalizeSubmissionType,
  normalizeXIdLegacy,
  normalizeLegacyUrl,
  splitCsvStringPreserveEmpty,
  splitLegacyEventIds,
  submissionTypeFromLegacyVideo,
  toUnixSec,
};
