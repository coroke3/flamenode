import { z } from "zod";
import { isCanonicalXId, normalizeXId } from "#utils/xid";
import { parseMemberChapterTime } from "./memberInput.ts";
import { MAX_VIDEO_MEMBERS } from "./atomicLimits.ts";

const memberChapterSchema = z.object({
  time: z.string().trim().min(1, "メンバーチャプターの時刻を入力してください。"),
  label: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

const memberInputSchema = z.object({
  name: z.string().trim().max(80),
  x_user_id: z.string().trim().max(32),
  role: z.string().trim().max(80).optional().default(""),
  comment: z.string().trim().max(500).optional().default(""),
  chapters: z.array(memberChapterSchema).max(30).optional().default([]),
});

const membersJsonSchema = z.array(memberInputSchema).max(
  MAX_VIDEO_MEMBERS,
  `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。`,
);

export interface MemberChapterInput {
  time: string;
  label: string;
  note: string;
}

export interface MemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
  chapters: MemberChapterInput[];
}

export interface ParsedMemberChapter {
  time_seconds: number;
  label: string;
  note: string;
  order_index: number;
}

export function parseVideoMemberInputs(
  raw: FormDataEntryValue | null,
  isCollab: boolean,
):
  | { ok: true; members: MemberInput[] }
  | { ok: false; message: string } {
  if (!isCollab) return { ok: true, members: [] };
  if (typeof raw !== "string" || !raw.trim()) return { ok: true, members: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "合作メンバーの JSON が不正です。" };
  }

  const result = membersJsonSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "合作メンバーの入力が不正です。",
    };
  }

  const members: MemberInput[] = [];
  const seenXIds = new Set<string>();
  for (const item of result.data) {
    const xid = normalizeXId(item.x_user_id);
    const name = item.name.trim();
    if (!name && !xid) continue;

    // フロントのpatternだけに依存せず、DB write境界でもcanonical X handleを保証する。
    // 空欄は許可するが、入力された値は英数字/underscore 20文字以内だけを保存する。
    if (xid && !isCanonicalXId(xid)) {
      return {
        ok: false,
        message: `${name || item.x_user_id} の X ID が不正です。英数字とアンダースコア20文字以内で入力してください。`,
      };
    }
    if (xid && seenXIds.has(xid)) {
      return {
        ok: false,
        message: `同じ X ID（@${xid}）が複数のメンバーに設定されています。1人にまとめてください。`,
      };
    }
    if (xid) seenXIds.add(xid);

    members.push({
      name: name || (xid ? `@${xid}` : ""),
      x_user_id: xid,
      role: item.role ?? "",
      comment: item.comment ?? "",
      chapters: item.chapters ?? [],
    });
  }
  return { ok: true, members };
}

export function normalizeMemberChapters(
  member: MemberInput,
  memberIndex: number,
): { ok: true; chapters: ParsedMemberChapter[] } | { ok: false; message: string } {
  const fallbackLabel =
    member.role || member.name || (member.x_user_id ? `@${member.x_user_id}` : `メンバー${memberIndex + 1}`);
  const chapters: ParsedMemberChapter[] = [];

  for (const [order, ch] of (member.chapters ?? []).entries()) {
    const sec = parseMemberChapterTime(ch.time);
    if (sec === null) {
      return {
        ok: false,
        message: `${member.name || member.x_user_id} のチャプター時刻「${ch.time}」が不正です。`,
      };
    }
    const label = (ch.label || "").trim() || fallbackLabel;
    if (label.length > 120) {
      return { ok: false, message: `${member.name} のチャプターラベルが長すぎます。` };
    }
    const note = (ch.note || "").trim();
    if (note.length > 1000) {
      return { ok: false, message: `${member.name} のチャプターメモが長すぎます。` };
    }
    chapters.push({
      time_seconds: sec,
      label,
      note,
      order_index: order,
    });
  }
  return { ok: true, chapters };
}
