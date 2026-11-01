import {
  normalizeMemberChapters,
  parseVideoMemberInputs,
  type MemberInput,
  type ParsedMemberChapter,
} from "./memberInputs.ts";

/** Pure SA-086/088/089 form validation reused in CURRENT and Hono. */
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

