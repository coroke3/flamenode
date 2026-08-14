/**
 * Event-scoped YouTube description templates.
 *
 * Templates are plain text.  The `{{variable_name}}` form is intentionally
 * small and deterministic so the same renderer can be used on the server and
 * in the client-side copy preview without pulling in any database code.
 */

export const MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH = 10_000;

export const YOUTUBE_DESCRIPTION_VARIABLES = [
  { key: "event_title", label: "イベント名" },
  { key: "event_id", label: "イベントID" },
  { key: "event_url", label: "イベントURL" },
  { key: "video_id", label: "作品ID" },
  { key: "title", label: "作品タイトル" },
  { key: "youtube_video_id", label: "YouTube動画ID" },
  { key: "youtube_url", label: "YouTube URL" },
  { key: "creator_name", label: "投稿者名" },
  { key: "creator_x_id", label: "投稿者X ID" },
  { key: "creator_channel_url", label: "投稿者YouTubeチャンネル" },
  { key: "creator_profile", label: "投稿者プロフィール" },
  { key: "creator_social_links", label: "投稿者SNSリンク" },
  { key: "members", label: "共同制作者" },
  { key: "member_names", label: "共同制作者名" },
  { key: "member_x_ids", label: "共同制作者X ID" },
  { key: "member_roles", label: "共同制作者の役割" },
  { key: "member_comments", label: "共同制作者コメント" },
  { key: "part", label: "部" },
  { key: "music", label: "楽曲" },
  { key: "credit", label: "クレジット" },
  { key: "intro_comment", label: "作品紹介" },
  { key: "highlights", label: "見どころ" },
  { key: "production_story", label: "制作エピソード" },
  { key: "used_software", label: "使用ソフト" },
  { key: "closing_comment", label: "あとがき" },
] as const;

export type YoutubeDescriptionVariableKey =
  (typeof YOUTUBE_DESCRIPTION_VARIABLES)[number]["key"];

export type YoutubeDescriptionContext = Partial<
  Record<YoutubeDescriptionVariableKey, string | number | null | undefined>
>;

export interface YoutubeDescriptionMember {
  name?: string | null;
  x_user_id?: string | null;
  role?: string | null;
  comment?: string | null;
}

export interface YoutubeDescriptionMemberValues {
  members: string;
  member_names: string;
  member_x_ids: string;
  member_roles: string;
  member_comments: string;
}

function cleanMemberValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMemberXId(value: string | null | undefined): string {
  return cleanMemberValue(value).replace(/^@+/, "").toLowerCase();
}

/**
 * Build copy-ready member values while omitting empty member rows and fields.
 * The aggregate `members` value keeps the original compact name/ID format;
 * the additional fields let an event template choose a more specific list.
 */
export function formatYoutubeDescriptionMembers(
  members: readonly YoutubeDescriptionMember[] | null | undefined,
): YoutubeDescriptionMemberValues {
  const rows = (members ?? [])
    .map((member) => ({
      name: cleanMemberValue(member.name),
      xId: cleanMemberXId(member.x_user_id),
      role: cleanMemberValue(member.role),
      comment: cleanMemberValue(member.comment),
    }))
    .filter((member) => member.name || member.xId);

  return {
    members: rows
      .map((member) => member.name || (member.xId ? `@${member.xId}` : ""))
      .filter(Boolean)
      .join(" / "),
    member_names: rows
      .map((member) => member.name)
      .filter(Boolean)
      .join(" / "),
    member_x_ids: rows
      .map((member) => (member.xId ? `@${member.xId}` : ""))
      .filter(Boolean)
      .join(" / "),
    member_roles: rows
      .map((member) => member.role)
      .filter(Boolean)
      .join(" / "),
    member_comments: rows
      .map((member) => member.comment)
      .filter(Boolean)
      .join(" / "),
  };
}

const ALLOWED_VARIABLES = new Set<YoutubeDescriptionVariableKey>(
  YOUTUBE_DESCRIPTION_VARIABLES.map((variable) => variable.key),
);

export function normalizeYoutubeDescriptionTemplate(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}

export interface RenderedYoutubeDescription {
  text: string;
  unknownVariables: string[];
  usedVariables: YoutubeDescriptionVariableKey[];
}

/**
 * Render a plain-text template. Unknown variables are replaced with an empty
 * string and reported to the caller so a typo never leaks into a YouTube
 * description as an unresolved token.
 */
export function renderYoutubeDescriptionTemplate(
  template: string | null | undefined,
  context: YoutubeDescriptionContext,
): RenderedYoutubeDescription {
  const normalized = normalizeYoutubeDescriptionTemplate(template)?.slice(
    0,
    MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  );
  if (!normalized) {
    return { text: "", unknownVariables: [], usedVariables: [] };
  }

  const unknownVariables = new Set<string>();
  const usedVariables = new Set<YoutubeDescriptionVariableKey>();
  const text = normalized.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (_match, rawKey: string) => {
      rawKey = rawKey.trim();
      if (!ALLOWED_VARIABLES.has(rawKey as YoutubeDescriptionVariableKey)) {
        unknownVariables.add(rawKey);
        return "";
      }
      const key = rawKey as YoutubeDescriptionVariableKey;
      usedVariables.add(key);
      const value = context[key];
      return value == null ? "" : String(value);
    },
  );

  return {
    text,
    unknownVariables: Array.from(unknownVariables).sort(),
    usedVariables: Array.from(usedVariables),
  };
}
