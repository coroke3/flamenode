export interface VideoMemberChapterInput {
  time: string;
  label: string;
  note: string;
}

export interface VideoMemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
  chapters?: VideoMemberChapterInput[];
  can_edit?: number | boolean;
  is_public_member?: number | boolean;
  order_index?: number;
}

export interface VideoMemberSuggestion {
  name: string;
  x_user_id: string;
}

export interface ParsedVideoMemberCsv {
  members: VideoMemberInput[];
  warnings: string[];
}

function normalizeXIdLocal(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function parseMemberChapterTime(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,4}):([0-5]?\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }
  return minutes * 60 + seconds;
}

export function normalizeMemberChapterTime(raw: string): string | null {
  const parsed = parseMemberChapterTime(raw);
  if (parsed === null) return null;
  const minutes = Math.floor(parsed / 60);
  const seconds = parsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function splitChapterTimes(raw: string): string[] {
  return raw
    .split(/[;\s,、]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCsv(input: string): string[][] {
  if (typeof input !== "string") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = input.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function looksLikeChapterCell(raw: string | undefined): boolean {
  if (!raw) return false;
  if (raw.includes("|")) return true;
  return splitChapterTimes(raw).some((part) => normalizeMemberChapterTime(part));
}

export function parseChaptersCell(cell: string): VideoMemberChapterInput[] {
  const out: VideoMemberChapterInput[] = [];
  for (const raw of cell.split(/[;\n]/)) {
    const t = raw.trim();
    if (!t) continue;
    if (!t.includes("|")) {
      for (const timeRaw of splitChapterTimes(t)) {
        const time = normalizeMemberChapterTime(timeRaw) ?? timeRaw;
        out.push({ time, label: "", note: "" });
      }
      continue;
    }
    const cols = t.split("|");
    const time = normalizeMemberChapterTime(cols[0] ?? "") ?? (cols[0] ?? "").trim();
    const label = (cols[1] ?? "").trim();
    const note = (cols[2] ?? "").trim();
    if (!time) continue;
    out.push({ time, label, note });
  }
  return out;
}

export function serializeChaptersCell(chapters: VideoMemberChapterInput[]): string {
  return chapters
    .map((c) => normalizeMemberChapterTime(c.time) ?? c.time.trim())
    .filter(Boolean)
    .join(";");
}

export function memberKey(m: VideoMemberInput): string {
  const xid = normalizeXIdLocal(m.x_user_id);
  if (xid) return `x:${xid}`;
  return `n:${m.name.trim().toLowerCase()}`;
}

export function chapterKey(mk: string, ch: VideoMemberChapterInput): string {
  return `${mk}:${normalizeMemberChapterTime(ch.time) ?? ch.time.trim()}`;
}

function headerIndex(headers: string[], aliases: string[]): number | null {
  const normalizedAliases = aliases.map((a) => a.trim().toLowerCase());
  const index = headers.findIndex((header) =>
    normalizedAliases.includes(header.trim().toLowerCase()),
  );
  return index >= 0 ? index : null;
}

export function parseVideoMemberCsv(
  input: string,
  options: {
    suggestions?: VideoMemberSuggestion[];
    existingMembers?: VideoMemberInput[];
  } = {},
): ParsedVideoMemberCsv {
  try {
    let rowsRaw = parseCsv(input);
    if (rowsRaw.length === 0) {
      return { members: [], warnings: ["CSVに有効な行がありません。"] };
    }

    const firstLower = rowsRaw[0]!.map((c) => c.trim().toLowerCase());
    const header = {
      name: headerIndex(firstLower, ["活動名", "name", "display_name"]),
      xid: headerIndex(firstLower, ["id", "x id", "x_id", "x_user_id"]),
      chapters: headerIndex(firstLower, ["チャプター", "chapter", "chapters"]),
      role: headerIndex(firstLower, ["役割", "role"]),
      comment: headerIndex(firstLower, ["コメント", "comment"]),
    };
    const headerHitCount = new Set(
      Object.values(header).filter((index): index is number => index !== null),
    ).size;
    const hasHeader = headerHitCount >= 2;
    if (hasHeader) rowsRaw = rowsRaw.slice(1);

    const suggestionsById = new Map<string, VideoMemberSuggestion>();
    for (const suggestion of options.suggestions ?? []) {
      const key = normalizeXIdLocal(suggestion.x_user_id);
      if (key) suggestionsById.set(key, suggestion);
    }

    const warnings: string[] = [];
    const members: VideoMemberInput[] = [];
    rowsRaw.forEach((cols, rowIndex) => {
      const oldOrder =
        !hasHeader &&
        looksLikeChapterCell(cols[4]) &&
        !looksLikeChapterCell(cols[2]);
      const hasExplicitChapterColumn =
        hasHeader ? header.chapters !== null : cols.length >= 5 || looksLikeChapterCell(cols[2]);
      const nameRaw = cols[header.name ?? 0] ?? "";
      const xidRaw = cols[header.xid ?? 1] ?? "";
      const chaptersRaw = hasHeader
        ? (header.chapters !== null ? (cols[header.chapters] ?? "") : "")
        : oldOrder
          ? (cols[4] ?? "")
          : hasExplicitChapterColumn
            ? (cols[2] ?? "")
            : "";
      const roleRaw = hasHeader
        ? (header.role !== null ? (cols[header.role] ?? "") : "")
        : oldOrder
          ? (cols[2] ?? "")
          : hasExplicitChapterColumn
            ? (cols[3] ?? "")
            : (cols[2] ?? "");
      const commentRaw = hasHeader
        ? (header.comment !== null ? (cols[header.comment] ?? "") : "")
        : oldOrder
          ? (cols[3] ?? "")
          : hasExplicitChapterColumn
            ? (cols[4] ?? "")
            : (cols[3] ?? "");
      const xid = normalizeXIdLocal(xidRaw);
      const hit = xid ? suggestionsById.get(xid) : null;
      const member = {
        name: nameRaw.trim() || hit?.name || "",
        x_user_id: xid,
        role: roleRaw.trim(),
        comment: commentRaw.trim(),
        chapters: parseChaptersCell(chaptersRaw),
      };
      if (!member.name && !member.x_user_id) {
        warnings.push(`${rowIndex + (hasHeader ? 2 : 1)}行目は名前とX IDが空のため読み飛ばしました。`);
        return;
      }
      members.push(member);
    });

    const pastedXids = new Set<string>();
    const duplicatedXids = new Set<string>();
    for (const member of members) {
      const xid = normalizeXIdLocal(member.x_user_id);
      if (!xid) continue;
      if (pastedXids.has(xid)) duplicatedXids.add(xid);
      pastedXids.add(xid);
    }
    const existingXids = new Set(
      (options.existingMembers ?? [])
        .map((m) => normalizeXIdLocal(m.x_user_id))
        .filter(Boolean),
    );
    for (const xid of pastedXids) {
      if (existingXids.has(xid)) duplicatedXids.add(xid);
    }
    if (duplicatedXids.size > 0) {
      warnings.push(
        `重複するX IDがあります: ${Array.from(duplicatedXids)
          .map((xid) => `@${xid}`)
          .join(", ")}`,
      );
    }

    return { members, warnings };
  } catch {
    return {
      members: [],
      warnings: ["CSVを解析できませんでした。引用符やカンマの数を確認してください。"],
    };
  }
}
