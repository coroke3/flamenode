/** MIG-0650 U03: standalone pure SA-085 member submission validation. */
import { z } from "zod";
import { isCanonicalXId, normalizeXId } from "../xid/format.ts";
import { MAX_VIDEO_MEMBERS } from "./atomicLimits.ts";

/** CURRENT-compatible mm:ss parser, kept local to avoid UI/Next dependencies. */
function parseMemberChapterTime(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,4}):([0-5]?\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }
  return minutes * 60 + seconds;
}


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

  // Zod traverses array elements even when the collection exceeds .max(100).
  // Hostile but byte-bounded JSON may contain thousands of tiny invalid rows:
  // reject the count before nested validation to protect the Worker CPU budget.
  // Use the existing max-members error text; non-collaboration still returns
  // above without inspecting its optional member payload.
  if (Array.isArray(parsed) && parsed.length > MAX_VIDEO_MEMBERS) {
    return { ok: false, message: `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。` };
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
    const rawXId = item.x_user_id.trim();
    const xid = normalizeXId(item.x_user_id);
    const name = item.name.trim();

    // A supplied handle such as "@" / "@@@" normalizes to empty, but is NOT
    // an omitted optional X ID. Reject it before the blank-member skip so
    // both the CURRENT Next bridge and unmounted Hono candidate fail closed.
    // Only a genuinely blank input may be ignored or saved without an X ID.
    if (rawXId && (!xid || !isCanonicalXId(xid))) {
      return {
        ok: false,
        message: `${name || item.x_user_id} の X ID が不正です。英数字とアンダースコア20文字以内で入力してください。`,
      };
    }
    if (!name && !xid) continue;

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

/** SA-085 U03c: pure CURRENT-compatible save/no-op decision, reusable by Hono. */
export function classifyAdminVideoMemberSave(input: {
  previousCollaborationType: string | null;
  memberCount: number;
  isCollab: boolean;
  hasMemberAudit: boolean;
  hasChapterAudit: boolean;
}): {
  nextCollaborationType: "collab" | "individual";
  collaborationTypeChanged: boolean;
  videoPublicContentChanged: boolean;
} {
  const nextCollaborationType = input.memberCount > 0 || input.isCollab
    ? "collab"
    : "individual";
  const collaborationTypeChanged =
    input.previousCollaborationType !== nextCollaborationType;
  return {
    nextCollaborationType,
    collaborationTypeChanged,
    videoPublicContentChanged:
      collaborationTypeChanged || input.hasMemberAudit || input.hasChapterAudit,
  };
}

/** SA-085 U03b: CURRENT submission validation with no Next, D1 or Queue dependency. */
export interface ValidatedMemberSubmission {
  members: MemberInput[];
  chaptersByIndex: Map<number, ParsedMemberChapter[]>;
}

export function validateVideoMemberSubmission(
  formData: FormData,
  isCollab: boolean,
): { ok: true; value: ValidatedMemberSubmission } | { ok: false; message: string } {
  const parsed = parseVideoMemberInputs(formData.get("members_json"), isCollab);
  if (!parsed.ok) return parsed;

  const chaptersByIndex = new Map<number, ParsedMemberChapter[]>();
  for (let i = 0; i < parsed.members.length; i++) {
    const normalized = normalizeMemberChapters(parsed.members[i], i);
    if (!normalized.ok) return normalized;
    chaptersByIndex.set(i, normalized.chapters);
  }
  return { ok: true, value: { members: parsed.members, chaptersByIndex } };
}
