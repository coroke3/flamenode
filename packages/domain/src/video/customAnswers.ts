/**
 * MIG-0651 SA-086 candidate: pure CURRENT-compatible general custom-answer
 * validation. FormData may contain repeated checkbox values; scalar duplicate
 * policy is intentionally different from videoForm's single-value fields.
 * The D1 loader remains in server-core; this file has no I/O.
 */
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "./atomicLimits.ts";

export type SubmissionCustomQuestionType =
  | "text" | "textarea" | "select" | "radio" | "checkbox";
export type SubmissionCustomQuestion = {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  type: SubmissionCustomQuestionType;
  required: boolean;
  options: string[];
  max_length: number | null;
  is_active: boolean;
};
export type SubmissionCustomAnswerDraft = {
  event_id: string;
  question_id: string;
  question_key: string;
  answer_text: string | null;
  answer_json: string | null;
};

const QUESTION_OPTIONS_MAX = 50;
const OPTION_MAX_LENGTH = 200;

/** Byte-for-byte match for CURRENT's parseOptionsJson normalization. */
export function parseSubmissionQuestionOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of values) {
      if (typeof item !== "string") continue;
      const clipped = item.trim().slice(0, OPTION_MAX_LENGTH);
      const trimmed = /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= QUESTION_OPTIONS_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function parseSubmissionQuestionType(raw: string): SubmissionCustomQuestionType {
  return raw === "text" || raw === "textarea" || raw === "select" ||
    raw === "radio" || raw === "checkbox" ? raw : "textarea";
}

/**
 * Mirrors CURRENT validateAnswerInput/readCustomAnswersFromFormData for a
 * single eligible unslotted event, including required errors and option order.
 * This is only a preflight: answers must be reasserted in an atomic write plan.
 */
export function validateSubmissionCustomAnswers(
  formData: FormData,
  questions: readonly SubmissionCustomQuestion[],
):
  | { ok: true; drafts: SubmissionCustomAnswerDraft[] }
  | { ok: false; message: string } {
  const drafts: SubmissionCustomAnswerDraft[] = [];
  for (const question of questions) {
    if (!question.is_active) continue;
    const key = `custom_answer:${question.event_id}:${question.question_key}`;
    const values = Array.from(new Set(
      formData.getAll(key).map((entry) =>
        typeof entry === "string" ? entry.trim() : "",
      ).filter(Boolean),
    ));
    if (question.required && values.length === 0) {
      return { ok: false, message: `${question.label}を入力してください。` };
    }
    if (values.length === 0) continue;
    let answerText: string | null = null;
    let answerJson: string | null = null;
    if (question.type === "text" || question.type === "textarea") {
      const value = values[0]!;
      const maxLen = question.max_length ?? (question.type === "text" ? 200 : 1000);
      if (value.length > maxLen) {
        return { ok: false, message: `${question.label}は${maxLen}文字以内で入力してください。` };
      }
      answerText = value;
    } else if (question.type === "select" || question.type === "radio") {
      if (!question.options.includes(values[0]!)) {
        return { ok: false, message: `${question.label}は選択肢から選んでください。` };
      }
      answerText = values[0]!;
    } else if (question.type === "checkbox") {
      if (values.some((value) => !question.options.includes(value))) {
        return { ok: false, message: `${question.label}は選択肢から選んでください。` };
      }
      answerJson = JSON.stringify(values);
    } else {
      continue;
    }
    drafts.push({
      event_id: question.event_id,
      question_id: question.id,
      question_key: question.question_key,
      answer_text: answerText,
      answer_json: answerJson,
    });
  }
  // CURRENT validates every answer first, then applies the atomic write cap;
  // an invalid late answer must not be hidden by an earlier count violation.
  if (drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    return {
      ok: false,
      message: `カスタム質問の回答は最大${MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS}件まで保存できます。`,
    };
  }
  return { ok: true, drafts };
}
