import type { DB } from "@/lib/db/client";
import { fetchActiveCustomQuestionsForEvents } from "@/lib/video/customQuestionAnswers";
import {
  readCustomAnswersFromFormData,
  type CustomAnswerDraft,
} from "@/lib/video/customQuestions";
import { MAX_VIDEO_CUSTOM_QUESTIONS } from "@/lib/video/customQuestionLimits";
import {
  type MemberInput,
  type ParsedMemberChapter,
  normalizeMemberChapters,
  parseVideoMemberInputs,
} from "@/lib/video/memberInputs";

export const CUSTOM_ANSWER_REPLACE_SENTINEL_ID = "__replace_custom_answers__";

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
  | { ok: true; drafts: CustomAnswerDraft[] }
  | { ok: false; message: string }
> {
  let customQuestionsByEvent: Awaited<ReturnType<typeof fetchActiveCustomQuestionsForEvents>>;
  try {
    customQuestionsByEvent = await fetchActiveCustomQuestionsForEvents(db, eventIds);
  } catch (error) {
    console.warn("[submissionValidation] custom question read rejected", error);
    return { ok: false, message: "イベントのカスタム質問設定が上限を超えています。" };
  }

  const questionCount = [...customQuestionsByEvent.values()].reduce(
    (total, questions) => total + questions.length,
    0,
  );
  if (questionCount > MAX_VIDEO_CUSTOM_QUESTIONS) {
    return {
      ok: false,
      message: `選択イベントのカスタム質問は合計${MAX_VIDEO_CUSTOM_QUESTIONS}件までです。`,
    };
  }

  const customAnswerRead = readCustomAnswersFromFormData(
    formData,
    customQuestionsByEvent,
  );
  if (customAnswerRead.errors.length > 0) {
    return { ok: false, message: customAnswerRead.errors[0] };
  }

  // 回答が0件でも「回答フォームを明示的に送信した」ことを保存計画へ伝える。
  // イベント紐付けのみ変更したケースと区別し、任意回答を全消去できるようにする。
  const drafts = customAnswerRead.drafts.length > 0
    ? customAnswerRead.drafts
    : [{
        event_id: "",
        question_id: CUSTOM_ANSWER_REPLACE_SENTINEL_ID,
        question_key: CUSTOM_ANSWER_REPLACE_SENTINEL_ID,
        answer_text: null,
        answer_json: null,
      }];
  return { ok: true, drafts };
}
