import type { eventCustomQuestions, videoCustomAnswers } from "@/lib/db/schema";
import {
  MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH,
  MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH,
  MAX_CUSTOM_QUESTION_KEY_LENGTH,
  MAX_CUSTOM_QUESTION_LABEL_LENGTH,
  MAX_CUSTOM_QUESTION_OPTION_LENGTH,
  MAX_CUSTOM_QUESTION_OPTIONS,
  MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH,
  MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH,
  MAX_CUSTOM_QUESTION_TEXT_LENGTH,
} from "@/lib/video/customQuestionLimits";

export type CustomQuestionType = "text" | "textarea" | "select" | "radio" | "checkbox";
export type CustomQuestionVisibility = "review" | "private" | "public";

export type CustomQuestionRow = typeof eventCustomQuestions.$inferSelect;
export type CustomAnswerRow = typeof videoCustomAnswers.$inferSelect;

export interface CustomQuestion {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: CustomQuestionType;
  required: boolean;
  options: string[];
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: boolean;
  visibility: CustomQuestionVisibility;
}

export type EditableCustomQuestion = Omit<CustomQuestion, "event_id">;
export type CustomAnswerValue = string | string[];

export interface CustomAnswerDraft {
  event_id: string;
  question_id: string;
  question_key: string;
  answer_text: string | null;
  answer_json: string | null;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  "text", "textarea", "select", "radio", "checkbox",
]);
const VALID_VISIBILITY: ReadonlySet<string> = new Set([
  "review", "private", "public",
]);
const QUESTION_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isCustomQuestionType(value: unknown): value is CustomQuestionType {
  return typeof value === "string" && VALID_TYPES.has(value);
}

export function isCustomQuestionVisibility(
  value: unknown,
): value is CustomQuestionVisibility {
  return typeof value === "string" && VALID_VISIBILITY.has(value);
}

export function isValidCustomQuestionKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CUSTOM_QUESTION_KEY_LENGTH &&
    value === value.trim() &&
    QUESTION_KEY_PATTERN.test(value);
}

function assertNullableBoundedText(
  value: string | null,
  maxLength: number,
  errorCode: string,
): void {
  if (value === null) return;
  if (!value || value.length > maxLength || value !== value.trim()) {
    throw new Error(errorCode);
  }
}

function parseStringArray(
  value: unknown,
  errorCode: string,
): string[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_QUESTION_OPTIONS) {
    throw new Error(errorCode);
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !item ||
      item !== item.trim() ||
      item.length > MAX_CUSTOM_QUESTION_OPTION_LENGTH ||
      seen.has(item)
    ) {
      throw new Error(errorCode);
    }
    seen.add(item);
    values.push(item);
  }
  return values;
}

export function parseOptionsJson(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  if (!raw) throw new Error("invalid_custom_question_options_json");
  try {
    return parseStringArray(
      JSON.parse(raw) as unknown,
      "invalid_custom_question_options_json",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "invalid_custom_question_options_json"
    ) {
      throw error;
    }
    throw new Error("invalid_custom_question_options_json");
  }
}

export function rowToQuestion(row: CustomQuestionRow): CustomQuestion {
  if (!isValidCustomQuestionKey(row.question_key)) {
    throw new Error("invalid_custom_question_key");
  }
  if (
    !row.label ||
    row.label !== row.label.trim() ||
    row.label.length > MAX_CUSTOM_QUESTION_LABEL_LENGTH
  ) {
    throw new Error("invalid_custom_question_label");
  }
  assertNullableBoundedText(
    row.description,
    MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH,
    "invalid_custom_question_description",
  );
  assertNullableBoundedText(
    row.placeholder,
    MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH,
    "invalid_custom_question_placeholder",
  );
  if (!isCustomQuestionType(row.type)) {
    throw new Error("invalid_custom_question_type");
  }
  if (!isCustomQuestionVisibility(row.visibility)) {
    throw new Error("invalid_custom_question_visibility");
  }
  if (row.required !== 0 && row.required !== 1) {
    throw new Error("invalid_custom_question_required");
  }
  if (row.is_active !== 0 && row.is_active !== 1) {
    throw new Error("invalid_custom_question_active");
  }
  if (!Number.isSafeInteger(row.sort_order) || row.sort_order < 0) {
    throw new Error("invalid_custom_question_sort_order");
  }
  if (
    row.max_length !== null &&
    (!Number.isSafeInteger(row.max_length) ||
      row.max_length < 1 ||
      row.max_length > MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH)
  ) {
    throw new Error("invalid_custom_question_max_length");
  }

  const options = parseOptionsJson(row.options_json);
  const usesOptions = row.type === "select" || row.type === "radio" || row.type === "checkbox";
  if (usesOptions && options.length === 0) {
    throw new Error("custom_question_options_required");
  }
  if (!usesOptions && options.length > 0) {
    throw new Error("custom_question_options_not_allowed");
  }
  if (!usesOptions && row.type !== "text" && row.type !== "textarea") {
    throw new Error("invalid_custom_question_type");
  }
  if (usesOptions && row.max_length !== null) {
    throw new Error("custom_question_max_length_not_allowed");
  }

  return {
    id: row.id,
    event_id: row.event_id,
    question_key: row.question_key,
    label: row.label,
    description: row.description,
    type: row.type,
    required: row.required === 1,
    options,
    placeholder: row.placeholder,
    max_length: row.max_length,
    sort_order: row.sort_order,
    is_active: row.is_active === 1,
    visibility: row.visibility,
  };
}

export function parseCustomAnswerValuesJson(
  raw: string | null | undefined,
): Record<string, CustomAnswerValue> {
  if (raw === null || raw === undefined || raw === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid_custom_answer_values_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_custom_answer_values_json");
  }

  const values: Record<string, CustomAnswerValue> = {};
  for (const [questionId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!questionId || questionId !== questionId.trim()) {
      throw new Error("invalid_custom_answer_values_json");
    }
    if (typeof value === "string") {
      if (!value || value !== value.trim()) {
        throw new Error("invalid_custom_answer_values_json");
      }
      values[questionId] = value;
      continue;
    }
    const selected = parseStringArray(value, "invalid_custom_answer_values_json");
    if (selected.length === 0) {
      throw new Error("invalid_custom_answer_values_json");
    }
    values[questionId] = selected;
  }
  return values;
}

export function formatCustomAnswerValue(
  answerText: string | null | undefined,
  answerJson: string | null | undefined,
): string {
  const text = answerText?.trim();
  if (text) return text;
  return parseOptionsJson(answerJson).join("、");
}

type AnswerValidationResult =
  | { ok: true; drafts: CustomAnswerDraft[] }
  | { ok: false; message: string };

export function validateAnswerInput(
  question: CustomQuestion,
  values: string[],
): AnswerValidationResult {
  const filtered = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

  if (question.required && filtered.length === 0) {
    return { ok: false, message: `${question.label}を入力してください。` };
  }

  if (filtered.length === 0) {
    return { ok: true, drafts: [] };
  }

  if (question.type === "text" || question.type === "textarea") {
    if (filtered.length !== 1) {
      return { ok: false, message: `${question.label}の送信形式が不正です。` };
    }
    const value = filtered[0];
    const maxLen = question.max_length ?? (
      question.type === "text"
        ? MAX_CUSTOM_QUESTION_TEXT_LENGTH
        : MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH
    );
    if (value.length > maxLen) {
      return {
        ok: false,
        message: `${question.label}は${maxLen}文字以内で入力してください。`,
      };
    }
    return {
      ok: true,
      drafts: [{
        event_id: question.event_id,
        question_id: question.id,
        question_key: question.question_key,
        answer_text: value,
        answer_json: null,
      }],
    };
  }

  if (question.type === "select" || question.type === "radio") {
    if (filtered.length !== 1 || !question.options.includes(filtered[0])) {
      return { ok: false, message: `${question.label}は選択肢から選んでください。` };
    }
    return {
      ok: true,
      drafts: [{
        event_id: question.event_id,
        question_id: question.id,
        question_key: question.question_key,
        answer_text: filtered[0],
        answer_json: null,
      }],
    };
  }

  const selected = question.options.filter((option) => filtered.includes(option));
  if (selected.length !== filtered.length) {
    return { ok: false, message: `${question.label}は選択肢から選んでください。` };
  }
  return {
    ok: true,
    drafts: [{
      event_id: question.event_id,
      question_id: question.id,
      question_key: question.question_key,
      answer_text: null,
      answer_json: JSON.stringify(selected),
    }],
  };
}

export function readCustomAnswersFromFormData(
  formData: FormData,
  questionsByEventId: Map<string, CustomQuestion[]>,
): { drafts: CustomAnswerDraft[]; errors: string[] } {
  const drafts: CustomAnswerDraft[] = [];
  const errors: string[] = [];

  for (const [eventId, questions] of questionsByEventId) {
    for (const question of questions) {
      if (!question.is_active) continue;
      const name = `custom_answer:${eventId}:${question.question_key}`;
      const allValues = formData.getAll(name).map((value) =>
        typeof value === "string" ? value.trim() : ""
      ).filter(Boolean);

      const result = validateAnswerInput(question, allValues);
      if (!result.ok) {
        errors.push(result.message);
        continue;
      }
      if (result.drafts.length === 0) {
        drafts.push({
          event_id: question.event_id,
          question_id: question.id,
          question_key: question.question_key,
          answer_text: null,
          answer_json: null,
        });
        continue;
      }
      drafts.push(...result.drafts);
    }
  }

  return { drafts, errors };
}
