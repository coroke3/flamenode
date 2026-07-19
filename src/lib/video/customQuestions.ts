import type { eventCustomQuestions, videoCustomAnswers } from "@/lib/db/schema";
import {
  MAX_CUSTOM_QUESTION_OPTIONS,
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
const KEY_MAX_LEN = 64;
const OPTION_MAX_LEN = 200;

export function normalizeQuestionKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, KEY_MAX_LEN);
}

export function parseQuestionType(value: unknown): CustomQuestionType {
  if (typeof value === "string" && VALID_TYPES.has(value)) {
    return value as CustomQuestionType;
  }
  return "textarea";
}

export function parseVisibility(value: unknown): CustomQuestionVisibility {
  if (typeof value === "string" && VALID_VISIBILITY.has(value)) {
    return value as CustomQuestionVisibility;
  }
  return "review";
}

export function parseOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim().slice(0, OPTION_MAX_LEN);
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_CUSTOM_QUESTION_OPTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function rowToQuestion(row: CustomQuestionRow): CustomQuestion {
  return {
    id: row.id,
    event_id: row.event_id,
    question_key: row.question_key,
    label: row.label,
    description: row.description,
    type: parseQuestionType(row.type),
    required: row.required === 1,
    options: parseOptionsJson(row.options_json),
    placeholder: row.placeholder,
    max_length: row.max_length,
    sort_order: row.sort_order,
    is_active: row.is_active === 1,
    visibility: parseVisibility(row.visibility),
  };
}

export function parseCustomAnswerValuesJson(
  raw: string | null | undefined,
): Record<string, CustomAnswerValue> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const legacy: Record<string, CustomAnswerValue> = {};
      for (const item of parsed) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string") continue;
        if (Array.isArray(row.value)) {
          legacy[row.id] = row.value.filter((value): value is string => typeof value === "string");
        } else if (typeof row.value === "string") {
          legacy[row.id] = row.value;
        }
      }
      return legacy;
    }
    if (!parsed || typeof parsed !== "object") return {};
    const values: Record<string, CustomAnswerValue> = {};
    for (const [questionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        values[questionId] = value;
      } else if (Array.isArray(value)) {
        values[questionId] = value.filter((item): item is string => typeof item === "string");
      }
    }
    return values;
  } catch {
    return {};
  }
}

export function formatCustomAnswerValue(
  answerText: string | null | undefined,
  answerJson: string | null | undefined,
): string {
  const text = answerText?.trim();
  if (text) return text;
  const values = parseOptionsJson(answerJson);
  return values.join("、");
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
    const value = filtered[0];
    if (question.options.length === 0 || !question.options.includes(value)) {
      return { ok: false, message: `${question.label}は選択肢から選んでください。` };
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

  if (question.type === "checkbox") {
    if (question.options.length === 0) {
      return { ok: false, message: `${question.label}の選択肢が設定されていません。` };
    }
    for (const value of filtered) {
      if (!question.options.includes(value)) {
        return { ok: false, message: `${question.label}は選択肢から選んでください。` };
      }
    }
    return {
      ok: true,
      drafts: [{
        event_id: question.event_id,
        question_id: question.id,
        question_key: question.question_key,
        answer_text: null,
        answer_json: JSON.stringify(filtered),
      }],
    };
  }

  return { ok: true, drafts: [] };
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
      drafts.push(...result.drafts);
    }
  }

  return { drafts, errors };
}
