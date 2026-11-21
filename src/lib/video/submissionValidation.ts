import type { DB } from "@/lib/db/client";
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "@/lib/video/atomicLimits";
import { fetchActiveCustomQuestionsForEvents } from "@/lib/video/customQuestionAnswers";
import { readCustomAnswersFromFormData } from "@/lib/video/customQuestions";

// CURRENT compatibility entrypoint; the canonical implementation has no Next dependency.
export {
  validateVideoMemberSubmission,
  type ValidatedMemberSubmission,
} from "@flamenode/domain/video";

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
  let customQuestionsByEvent: Awaited<ReturnType<typeof fetchActiveCustomQuestionsForEvents>>;
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
  if (customAnswerRead.drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    return {
      ok: false,
      message: `カスタム質問の回答は最大${MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS}件まで保存できます。`,
    };
  }
  return { ok: true, drafts: customAnswerRead.drafts };
}
