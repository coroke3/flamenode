import type { LegacyParsedFile } from "./parse";

export type LegacyImportStrategy = "create_only" | "skip_existing" | "replace_imported";
export type CanonicalVisibility = "private" | "public";

export type CanonicalLegacyPlan = {
  events: Array<{
    id: string;
    title: string;
    event_type: "event" | "collabo" | "type" | "other";
    explanation: string | null;
    icon_url: string | null;
    img_url: string | null;
    visibility_status: CanonicalVisibility;
    start_time: number | null;
    end_time: number | null;
  }>;
  eventStaff: Array<{
    id: string;
    event_id: string;
    x_user_id: string;
    display_name: string;
    permission_preset: "owner" | "public_staff";
    is_public: 0 | 1;
    public_role_label: string | null;
  }>;
  xUsers: Array<{
    id: string;
    x_name: string;
    icon_url: string | null;
    youtube_channel_url: string | null;
    other_social_links: string | null;
  }>;
  videos: Array<{
    id: string;
    primary_event_id: string | null;
    creator_x_user_id: string | null;
    collaboration_type: "individual" | "collab";
    source_type: "youtube" | "external";
    creator_display_name: string;
    creator_display_name_yomi: string | null;
    creator_icon_url: string | null;
    creator_youtube_channel_url: string | null;
    title: string;
    music: string | null;
    credit: string | null;
    music_reference_url: string | null;
    closing_comment: string | null;
    youtube_video_id: string | null;
    intro_comment: string | null;
    highlights: string | null;
    production_story: string | null;
    visibility_status: CanonicalVisibility;
    scheduling_type: "manual";
    scheduled_time: number | null;
    created_at: number;
  }>;
  videoEvents: Array<{ video_id: string; event_id: string }>;
  videoMembers: Array<{
    id: string;
    video_id: string;
    x_user_id: string | null;
    name: string;
    role: string | null;
    order_index: number;
  }>;
  videoChapters: Array<{
    id: string;
    video_id: string;
    x_user_id: string | null;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    visibility: "public";
  }>;
  videoSoftwares: Array<{ video_id: string; label: string }>;
  warnings: string[];
  errors: string[];
};

type NormalizeOptions = {
  eventVisibility: CanonicalVisibility;
  videoVisibility: CanonicalVisibility;
  now?: number;
};

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  if (raw == null) return null;
  const value = String(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  return value || null;
}

function normalizeXId(raw: string | null): string | null {
  const value = (raw ?? "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeIconUrl(raw: string | null): string | null {
  if (!raw) return null;
  const match =
    raw.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/) ??
    raw.match(/drive\.google\.com\/(?:open|uc)\?[^#]*[?&]?id=([A-Za-z0-9_-]+)/);
  if (match?.[1]) return `/api/google-drive-image/${match[1]}`;
  if (raw.startsWith("/api/")) return raw;
  return normalizeUrl(raw);
}

function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((value) => value.trim());
  if (raw == null) return [];
  return String(raw).split(/[,、\n]/).map((value) => value.trim());
}

function toUnixSec(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (raw > 1e12) return Math.floor(raw / 1000);
    if (raw > 1e6) return Math.floor(raw);
    if (raw > 1 && raw < 60000) return Math.floor((raw - 25569) * 86400);
    return null;
  }
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return toUnixSec(Number(value));
  const jst = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (jst) {
    const ms = Date.UTC(
      Number(jst[1]),
      Number(jst[2]) - 1,
      Number(jst[3]),
      Number(jst[4] ?? 0) - 9,
      Number(jst[5] ?? 0),
      Number(jst[6] ?? 0),
    );
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function scheduledTime(row: Record<string, unknown>): number | null {
  const date = stringValue(row, "data");
  const time = stringValue(row, "time");
  if (date && time && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time)) {
    return toUnixSec(`${date} ${time}`);
  }
  return toUnixSec(time) ?? toUnixSec(row.timestamp) ?? toUnixSec(date);
}

function extractYoutubeId(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  for (const pattern of [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?[^#]*v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function stableId(prefix: string, seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function eventType(raw: string | null): "event" | "collabo" | "type" | "other" {
  const value = (raw ?? "").toLowerCase();
  if (value === "collabo" || value === "collab" || value === "collaboration") return "collabo";
  if (value === "type") return "type";
  if (!value || value === "event") return "event";
  return "other";
}

function isVideoRow(row: Record<string, unknown>): boolean {
  return ["ylink", "tlink", "creator", "type2", "beforecomment", "aftercomment"].some(
    (key) => key in row,
  );
}

function memberStarts(raw: unknown): Array<number | null> {
  return splitList(raw).map((value) => {
    const match = value.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (match) return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  });
}

export function normalizeLegacyFiles(
  files: readonly LegacyParsedFile[],
  options: NormalizeOptions,
): CanonicalLegacyPlan {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const events = new Map<string, CanonicalLegacyPlan["events"][number]>();
  const staff = new Map<string, CanonicalLegacyPlan["eventStaff"][number]>();
  const xUsers = new Map<string, CanonicalLegacyPlan["xUsers"][number]>();
  const videos = new Map<string, CanonicalLegacyPlan["videos"][number]>();
  const videoEvents = new Map<string, CanonicalLegacyPlan["videoEvents"][number]>();
  const members = new Map<string, CanonicalLegacyPlan["videoMembers"][number]>();
  const chapters = new Map<string, CanonicalLegacyPlan["videoChapters"][number]>();
  const softwares = new Map<string, CanonicalLegacyPlan["videoSoftwares"][number]>();
  const warnings: string[] = [];
  const errors: string[] = [];

  const putXUser = (id: string, name: string, extra: Partial<CanonicalLegacyPlan["xUsers"][number]> = {}) => {
    const current = xUsers.get(id);
    xUsers.set(id, {
      id,
      x_name: current?.x_name || name || `@${id}`,
      icon_url: current?.icon_url ?? extra.icon_url ?? null,
      youtube_channel_url: current?.youtube_channel_url ?? extra.youtube_channel_url ?? null,
      other_social_links: current?.other_social_links ?? extra.other_social_links ?? null,
    });
  };

  for (const file of files) {
    file.rows.forEach((row, rowIndex) => {
      const source = `${file.name}:${rowIndex + 2}`;
      if (!isVideoRow(row)) {
        const id = (stringValue(row, "eventid") ?? "").replace(/^@+/, "");
        if (!id) {
          errors.push(`${source}: eventid がありません。`);
          return;
        }
        const title = stringValue(row, "eventname") ?? id;
        events.set(id, {
          id,
          title,
          event_type: eventType(stringValue(row, "type")),
          explanation: stringValue(row, "explanation"),
          icon_url: normalizeIconUrl(stringValue(row, "icon")),
          img_url: normalizeIconUrl(stringValue(row, "img")),
          visibility_status: options.eventVisibility,
          start_time: toUnixSec(row.start),
          end_time: toUnixSec(row.end),
        });

        const names = splitList(row.member);
        const ids = splitList(row.memberid);
        const roles = splitList(row.memberpost ?? row.menberpost);
        const count = Math.max(names.length, ids.length, roles.length);
        let ownerAssigned = false;
        for (let index = 0; index < count; index += 1) {
          const xUserId = normalizeXId(ids[index] ?? null);
          if (!xUserId) {
            if (ids[index]) warnings.push(`${source}: memberid「${ids[index]}」を無視しました。`);
            continue;
          }
          const displayName = names[index] || `@${xUserId}`;
          const publicRole = roles[index] || null;
          const ownerHint = /主催|代表|統括|owner/i.test(publicRole ?? "");
          const permission = !ownerAssigned && (ownerHint || index === 0) ? "owner" : "public_staff";
          if (permission === "owner") ownerAssigned = true;
          const key = `${id}:${xUserId}`;
          staff.set(key, {
            id: stableId("staff_imp", key),
            event_id: id,
            x_user_id: xUserId,
            display_name: displayName,
            permission_preset: permission,
            is_public: publicRole ? 1 : 0,
            public_role_label: publicRole,
          });
          putXUser(xUserId, displayName);
        }
        if (count > 0 && !ownerAssigned) errors.push(`${source}: ownerにできるmemberidがありません。`);
        return;
      }

      const title = stringValue(row, "title") ?? "無題";
      const creatorName = stringValue(row, "creator") ?? "anonymous";
      const creatorXId = normalizeXId(stringValue(row, "tlink"));
      const youtubeId = extractYoutubeId(stringValue(row, "ylink"));
      const eventIds = splitList(row.eventid).map((value) => value.replace(/^@+/, "")).filter(Boolean);
      const videoId = youtubeId
        ? `legacy_${youtubeId}`
        : stableId("legacy_video", [eventIds.join(","), creatorXId ?? "", title, stringValue(row, "ylink") ?? ""].join("|"));
      if (videos.has(videoId)) {
        errors.push(`${source}: 作品ID ${videoId} が入力内で重複しています。`);
        return;
      }
      if (creatorXId) {
        putXUser(creatorXId, creatorName, {
          icon_url: normalizeIconUrl(stringValue(row, "icon")),
          youtube_channel_url: normalizeUrl(stringValue(row, "ychlink")),
          other_social_links: normalizeUrl(stringValue(row, "othersns")) ?? stringValue(row, "othersns"),
        });
      } else if (stringValue(row, "tlink")) {
        warnings.push(`${source}: tlinkをX IDとして解釈できませんでした。`);
      }

      const memberNames = splitList(row.member);
      const memberIds = splitList(row.memberid);
      const starts = memberStarts(row.starts);
      const memberCount = Math.max(memberNames.length, memberIds.length);
      for (let index = 0; index < memberCount; index += 1) {
        const xUserId = normalizeXId(memberIds[index] ?? null);
        const name = memberNames[index] || (xUserId ? `@${xUserId}` : "");
        if (!name && !xUserId) continue;
        const memberId = stableId("member_imp", `${videoId}:${index}:${xUserId ?? name}`);
        members.set(memberId, {
          id: memberId,
          video_id: videoId,
          x_user_id: xUserId,
          name: name || `@${xUserId}`,
          role: null,
          order_index: index,
        });
        if (xUserId) putXUser(xUserId, name || `@${xUserId}`);
        const start = starts[index];
        if (start != null) {
          const chapterId = stableId("chapter_imp", `${videoId}:${index}:${start}`);
          chapters.set(chapterId, {
            id: chapterId,
            video_id: videoId,
            x_user_id: xUserId,
            chapter_time: start,
            chapter_label: name || `@${xUserId}`,
            note: null,
            visibility: "public",
          });
        }
      }

      const legacyNotes = [
        ["ステージ利用", stringValue(row, "righttype")],
        ["登壇", stringValue(row, "toudan")],
        ["制作経験", stringValue(row, "movieyear")],
      ]
        .filter((item): item is [string, string] => !!item[1])
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
      const highlights = [stringValue(row, "hitokoto"), stringValue(row, "ycomment")]
        .filter((value): value is string => !!value)
        .join("\n") || null;
      const createdAt = toUnixSec(row.timestamp) ?? scheduledTime(row) ?? now;
      videos.set(videoId, {
        id: videoId,
        primary_event_id: eventIds[0] ?? null,
        creator_x_user_id: creatorXId,
        collaboration_type: memberCount > 1 || /collab|合作|複数|団体/i.test(stringValue(row, "type2") ?? stringValue(row, "type") ?? "")
          ? "collab"
          : "individual",
        source_type: youtubeId ? "youtube" : "external",
        creator_display_name: creatorName,
        creator_display_name_yomi: stringValue(row, "yomi"),
        creator_icon_url: normalizeIconUrl(stringValue(row, "icon")),
        creator_youtube_channel_url: normalizeUrl(stringValue(row, "ychlink")),
        title,
        music: stringValue(row, "music"),
        credit: stringValue(row, "credit"),
        music_reference_url: normalizeUrl(stringValue(row, "ymulink")),
        closing_comment: stringValue(row, "aftercomment"),
        youtube_video_id: youtubeId,
        intro_comment: stringValue(row, "comment") ?? stringValue(row, "beforecomment"),
        highlights,
        production_story: legacyNotes || null,
        visibility_status: options.videoVisibility,
        scheduling_type: "manual",
        scheduled_time: scheduledTime(row),
        created_at: createdAt,
      });
      eventIds.forEach((eventId) => {
        videoEvents.set(`${videoId}:${eventId}`, { video_id: videoId, event_id: eventId });
      });
      splitList(row.soft)
        .filter(Boolean)
        .forEach((label) => softwares.set(`${videoId}:${label.toLowerCase()}`, { video_id: videoId, label }));
    });
  }

  return {
    events: [...events.values()],
    eventStaff: [...staff.values()],
    xUsers: [...xUsers.values()],
    videos: [...videos.values()],
    videoEvents: [...videoEvents.values()],
    videoMembers: [...members.values()],
    videoChapters: [...chapters.values()],
    videoSoftwares: [...softwares.values()],
    warnings,
    errors,
  };
}
