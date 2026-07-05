import type { DB } from "@/lib/db/client";
import { fetchActiveCustomQuestionsForEvents } from "@/lib/video/customQuestionAnswers";
import { readCustomAnswersFromFormData } from "@/lib/video/customQuestions";
import {
  type MemberInput,
  type ParsedMemberChapter,
  normalizeMemberChapters,
  parseVideoMemberInputs,
} from "@/lib/video/memberInputs";

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

export async function validateCustomAnswersForEvents(
  db: DB,
  formData: FormData,
  eventIds: string[],
): Promise<
  | {
      ok: true;
      drafts: ReturnType<typeof readCustomAnswersFromFormData>["drafts"];
    }
  | { ok: false; message: string }
> {
  const customQuestionsByEvent = await fetchActiveCustomQuestionsForEvents(
    db,
    eventIds,
  );
  const customAnswerRead = readCustomAnswersFromFormData(
    formData,
    customQuestionsByEvent,
  );
  if (customAnswerRead.errors.length > 0) {
    return { ok: false, message: customAnswerRead.errors[0] };
  }
  return { ok: true, drafts: customAnswerRead.drafts };
}
