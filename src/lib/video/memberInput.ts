import { parseDelimited } from "#utils/delimited";
import { normalizeXId } from "#utils/xid";

export interface VideoMemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
  can_edit?: number | boolean;
  is_public_member?: number | boolean;
  order_index?: number;
}

export interface VideoMemberSuggestion {
  name: string;
  x_user_id: string;
  score?: number;
  matchedBy?: string;
}

export interface ParsedVideoMemberCsv {
  members: VideoMemberInput[];
  warnings: string[];
}

export function memberKey(member: VideoMemberInput): string {
  const xId = normalizeXId(member.x_user_id);
  if (xId) return `x:${xId}`;
  return `n:${member.name.trim().normalize("NFKC").toLowerCase()}`;
}

/** CSV「編集権」列: ON / OFF / true / false / 1 / 0 / 空欄 */
export function parseMemberEditPermissionCell(
  raw: string | undefined,
): boolean | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (["on", "true", "1", "yes", "y", "はい"].includes(value)) return true;
  if (["off", "false", "0", "no", "n", "いいえ"].includes(value)) return false;
  return undefined;
}

function headerIndex(headers: string[], aliases: string[]): number | null {
  const normalizedAliases = aliases.map((alias) =>
    alias.trim().normalize("NFKC").toLowerCase(),
  );
  const index = headers.findIndex((header) =>
    normalizedAliases.includes(header.trim().normalize("NFKC").toLowerCase()),
  );
  return index >= 0 ? index : null;
}

/**
 * 正本の合作メンバーCSVだけを解析する。
 * 列: 活動名, ID, 役割, コメント, 編集権
 *
 * 旧列順やチャプター列は受理しない。旧データの変換はmigration専用処理で行う。
 */
export function parseVideoMemberCsv(
  input: string,
  options: {
    suggestions?: VideoMemberSuggestion[];
    existingMembers?: VideoMemberInput[];
  } = {},
): ParsedVideoMemberCsv {
  try {
    const rows = parseDelimited(input, ",");
    if (rows.length < 2) {
      return {
        members: [],
        warnings: [
          "CSVは1行目に「活動名,ID,役割,コメント,編集権」の見出しが必要です。",
        ],
      };
    }

    const headers = rows[0] ?? [];
    const columns = {
      name: headerIndex(headers, ["活動名", "name", "display_name"]),
      xId: headerIndex(headers, ["id", "x id", "x_id", "x_user_id"]),
      role: headerIndex(headers, ["役割", "role"]),
      comment: headerIndex(headers, ["コメント", "comment"]),
      canEdit: headerIndex(headers, ["編集権", "can_edit", "edit", "作品編集"]),
    };

    if (columns.name === null || columns.xId === null) {
      return {
        members: [],
        warnings: ["CSVの見出しに「活動名」と「ID」が必要です。"],
      };
    }

    const suggestionsById = new Map<string, VideoMemberSuggestion>();
    for (const suggestion of options.suggestions ?? []) {
      const key = normalizeXId(suggestion.x_user_id);
      if (key) suggestionsById.set(key, suggestion);
    }

    const warnings: string[] = [];
    const members: VideoMemberInput[] = [];
    rows.slice(1).forEach((cells, index) => {
      const xId = normalizeXId(cells[columns.xId!] ?? "");
      const suggestion = xId ? suggestionsById.get(xId) : undefined;
      const member: VideoMemberInput = {
        name: (cells[columns.name!] ?? "").trim() || suggestion?.name || "",
        x_user_id: xId,
        role: columns.role === null ? "" : (cells[columns.role] ?? "").trim(),
        comment:
          columns.comment === null ? "" : (cells[columns.comment] ?? "").trim(),
      };

      const canEdit =
        columns.canEdit === null
          ? undefined
          : parseMemberEditPermissionCell(cells[columns.canEdit]);
      if (canEdit !== undefined) member.can_edit = canEdit ? 1 : 0;

      if (!member.name && !member.x_user_id) {
        warnings.push(`${index + 2}行目は活動名とIDが空のため読み飛ばしました。`);
        return;
      }
      members.push(member);
    });

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const member of members) {
      const key = memberKey(member);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    for (const member of options.existingMembers ?? []) {
      const key = memberKey(member);
      if (seen.has(key)) duplicates.add(key);
    }
    if (duplicates.size > 0) {
      warnings.push("既存行または貼り付け行に重複するメンバーがあります。");
    }

    const editOnCount = members.filter(
      (member) => member.can_edit === 1 || member.can_edit === true,
    ).length;
    if (editOnCount > 0) {
      warnings.push(
        `編集権ONの行が${editOnCount}件あります。CSVでは権限を付与せず、「編集できる人」から設定してください。`,
      );
    }

    return { members, warnings };
  } catch {
    return {
      members: [],
      warnings: ["CSVを解析できませんでした。引用符やカンマを確認してください。"],
    };
  }
}
