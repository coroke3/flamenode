/**
 * Event-scoped YouTube description templates.
 *
 * Templates are plain text.  The `{{variable_name}}` form is intentionally
 * small and deterministic so the same renderer can be used on the server and
 * in the client-side copy preview without pulling in any database code.
 *
 * A single members-only loop is supported:
 *
 *   {{#members}}
 *   {{member_index}}. {{member_name}} @{{member_x_id}}
 *   {{/members}}
 *
 * The loop body is repeated once per member (input order). With zero members
 * the whole block disappears. Nesting is rejected and malformed blocks are
 * removed safely so raw tokens never leak into a YouTube description.
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

/** ループ内で使える変数。scalar側の {{member_*}} 集約値とは別系統。 */
export const YOUTUBE_DESCRIPTION_LOOP_VARIABLES = [
  { key: "member_index", label: "メンバー番号（1始まり）" },
  { key: "member_name", label: "メンバー表示名" },
  { key: "member_x_id", label: "メンバーX ID（@なし）" },
  { key: "member_chapter", label: "最初のチャプター時刻" },
  { key: "member_chapters", label: "全チャプター時刻（; 区切り）" },
  { key: "member_role", label: "メンバー役職" },
  { key: "member_comment", label: "メンバーコメント" },
] as const;

export type YoutubeDescriptionLoopVariableKey =
  (typeof YOUTUBE_DESCRIPTION_LOOP_VARIABLES)[number]["key"];

const ALLOWED_LOOP_VARIABLES = new Set<YoutubeDescriptionLoopVariableKey>(
  YOUTUBE_DESCRIPTION_LOOP_VARIABLES.map((variable) => variable.key),
);

export interface YoutubeDescriptionLoopMember {
  name?: string | null;
  x_user_id?: string | null;
  role?: string | null;
  comment?: string | null;
  chapters?: readonly { time?: string | null }[] | null;
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

function canonicalChapterTime(raw: string | null | undefined): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{1,4}):([0-5]?\d)$/);
  if (!match) return "";
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return "";
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface ResolvedLoopMember {
  member_index: string;
  member_name: string;
  member_x_id: string;
  member_chapter: string;
  member_chapters: string;
  member_role: string;
  member_comment: string;
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
  /** 壊れたloop構文などを安全に除去した際の人間向け警告。raw tokenは含まれない。 */
  templateWarnings: string[];
}

interface TemplateToken {
  start: number;
  end: number;
  key: string;
}

const TEMPLATE_TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function nextToken(template: string, from: number): TemplateToken | null {
  TEMPLATE_TOKEN_RE.lastIndex = from;
  const match = TEMPLATE_TOKEN_RE.exec(template);
  if (!match) return null;
  return {
    start: match.index,
    end: TEMPLATE_TOKEN_RE.lastIndex,
    key: (match[1] ?? "").trim(),
  };
}

const MEMBERS_LOOP_OPEN = "#members";
const MEMBERS_LOOP_CLOSE = "/members";

function resolveLoopMembers(
  members?: readonly YoutubeDescriptionLoopMember[] | null,
): ResolvedLoopMember[] {
  return (members ?? [])
      .map((member, index) => {
        const chapters = (member.chapters ?? [])
          .map((chapter) => canonicalChapterTime(chapter?.time))
          .filter(Boolean);
        return {
          member_index: String(index + 1),
          member_name: cleanMemberValue(member.name),
          member_x_id: cleanMemberXId(member.x_user_id),
          member_chapter: chapters[0] ?? "",
          member_chapters: chapters.join(";"),
          member_role: cleanMemberValue(member.role),
          member_comment: cleanMemberValue(member.comment),
        };
      })
      .filter(
        (member) => member.member_name || member.member_x_id,
      );
}

/**
 * Render a plain-text template. Unknown variables are replaced with an empty
 * string and reported to the caller so a typo never leaks into a YouTube
 * description as an unresolved token. The same function is used for live
 * preview and for the final copied description.
 */
export function renderYoutubeDescriptionTemplate(
  template: string | null | undefined,
  context: YoutubeDescriptionContext,
  options?: {
    members?: readonly YoutubeDescriptionLoopMember[] | null;
  },
): RenderedYoutubeDescription {
  const normalized = normalizeYoutubeDescriptionTemplate(template)?.slice(
    0,
    MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  );
  if (!normalized) {
    return { text: "", unknownVariables: [], usedVariables: [], templateWarnings: [] };
  }

  const unknownVariables = new Set<string>();
  const usedVariables = new Set<YoutubeDescriptionVariableKey>();
  const templateWarnings: string[] = [];

  const renderScalar = (rawKey: string): string => {
    if (!ALLOWED_VARIABLES.has(rawKey as YoutubeDescriptionVariableKey)) {
      unknownVariables.add(rawKey);
      return "";
    }
    const key = rawKey as YoutubeDescriptionVariableKey;
    usedVariables.add(key);
    const value = context[key];
    return value == null ? "" : String(value);
  };

  const loopMembers = resolveLoopMembers(options?.members);

  const loopValueResolvers: Array<[
    YoutubeDescriptionLoopVariableKey,
    (member: ResolvedLoopMember) => string,
  ]> = [
    ["member_index", (m) => m.member_index],
    ["member_name", (m) => m.member_name],
    ["member_x_id", (m) => m.member_x_id],
    ["member_chapter", (m) => m.member_chapter],
    ["member_chapters", (m) => m.member_chapters],
    ["member_role", (m) => m.member_role],
    ["member_comment", (m) => m.member_comment],
  ];

  const renderLoopBody = (body: string): string => {
    const renderedRows: string[] = [];
    for (const member of loopMembers) {
      let row = "";
      let cursor = 0;
      for (;;) {
        const token = nextToken(body, cursor);
        if (!token) {
          row += body.slice(cursor);
          break;
        }
        row += body.slice(cursor, token.start);
        const resolverEntry = loopValueResolvers.find(
          ([key]) => key === token.key,
        );
        if (resolverEntry) {
          row += resolverEntry[1](member);
        } else {
          // ループ内で許可されていない変数は空にして報告する。
          unknownVariables.add(token.key);
        }
        cursor = token.end;
      }
      renderedRows.push(row);
    }
    return renderedRows.join("");
  };

  let text = "";
  let cursor = 0;
  for (;;) {
    const token = nextToken(normalized, cursor);
    if (!token) {
      text += normalized.slice(cursor);
      break;
    }
    text += normalized.slice(cursor, token.start);

    if (token.key === MEMBERS_LOOP_OPEN || token.key === MEMBERS_LOOP_CLOSE) {
      if (token.key === MEMBERS_LOOP_CLOSE) {
        templateWarnings.push(
          "{{/members}} に対応する {{#members}} がありません。このブロックは出力から除きました。",
        );
        cursor = token.end;
        continue;
      }
      const innerStart = token.end;
      const close = findLoopClose(normalized, innerStart);
      if (close.kind === "unclosed") {
        templateWarnings.push(
          "{{#members}} ループが閉じられていません。このブロックは出力から除きました。",
        );
        // ブロック全体は落とさず、開始トークンだけ除去して以降を通常スカラーとして処理する。
        cursor = innerStart;
        continue;
      }
      if (close.kind === "nested") {
        templateWarnings.push(
          "{{#members}} ループのネストはできません。このブロックは出力から除きました。",
        );
        cursor = close.end;
        continue;
      }
      text += renderLoopBody(normalized.slice(innerStart, close.bodyEnd));
      cursor = close.end;
      continue;
    }

    text += renderScalar(token.key);
    cursor = token.end;
  }

  return {
    text,
    unknownVariables: Array.from(unknownVariables).sort(),
    usedVariables: Array.from(usedVariables),
    templateWarnings,
  };
}

type LoopCloseResult =
  | { kind: "closed"; bodyEnd: number; end: number }
  | { kind: "nested"; end: number }
  | { kind: "unclosed" };

/**
 * Find the closing `{{/members}}` for a block that starts at `from`.
 * Nesting is not allowed: an inner `{{#members}}` block is skipped and the
 * outer region is reported as malformed so the whole area is dropped.
 */
function findLoopClose(template: string, from: number): LoopCloseResult {
  let cursor = from;
  let sawNestedOpen = false;
  for (;;) {
    const token = nextToken(template, cursor);
    if (!token) return { kind: "unclosed" };
    if (token.key === MEMBERS_LOOP_OPEN) {
      const innerCloseEnd = findLoopCloseAllowingNothing(template, token.end);
      if (innerCloseEnd == null) {
        // 内部ブロックが閉じていない場合は閉じ不能として扱う。
        return { kind: "unclosed" };
      }
      cursor = innerCloseEnd;
      sawNestedOpen = true;
      continue;
    }
    if (token.key === MEMBERS_LOOP_CLOSE) {
      return sawNestedOpen
        ? { kind: "nested", end: token.end }
        : { kind: "closed", bodyEnd: token.start, end: token.end };
    }
    cursor = token.end;
  }
}

/** nested検出時の内部ブロック閉じ位置だけを見つけるヘルパー。 */
function findLoopCloseAllowingNothing(
  template: string,
  from: number,
): number | null {
  let cursor = from;
  for (;;) {
    const token = nextToken(template, cursor);
    if (!token) return null;
    if (token.key === MEMBERS_LOOP_CLOSE) return token.end;
    cursor = token.end;
  }
}
