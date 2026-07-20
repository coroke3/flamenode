import type { DB } from "@/lib/db/client";
import { fetchActiveCustomQuestionsForEvents } from "@/lib/video/customQuestionAnswers";
import { readCustomAnswersFromFormData } from "@/lib/video/customQuestions";
import {
  type MemberInput,
  parseVideoMemberInputs,
} from "@/lib/video/memberInputs";

export interface ValidatedMemberSubmission {
  members: MemberInput[];
}

export function validateVideoMemberSubmission(
  formData: FormData,
  isCollab: boolean,
):
  | { ok: true; value: ValidatedMemberSubmission }
  | { ok: false; message: string } {
  const parsed = parseVideoMemberInputs(formData.get("members_json"), isCollab);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { members: parsed.members } };
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
  let customQuestionsByEvent: Awaited<
    ReturnType<typeof fetchActiveCustomQuestionsForEvents>
  >;
  try {
    customQuestionsByEvent = await fetchActiveCustomQuestionsForEvents(db, eventIds);
  } catch (error) {
    console.warn("[submissionValidation] custom question read rejected", error);
    return { ok: false, message: "カスタム質問数が保存上限を超えています。" };
  }
  const customAnswerRead = readCustomAnswersFromFormData(
    formData,
    customQuestionsByEvent,
  );
  if (customAnswerRead.errors.length > 0) {
    return { ok: false, message: customAnswerRead.errors[0] };
  }
  return { ok: true, drafts: customAnswerRead.drafts };
}
