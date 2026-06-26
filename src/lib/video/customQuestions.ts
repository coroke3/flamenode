import type { eventCustomQuestions, videoCustomAnswers } from "@/lib/db/schema";

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

export interface CustomAnswerDraft {
  event_id: string;
  question_id: string;
  question_key: string;
  answer_text: string | null;
  answer_json: string | null;
}

export interface CustomAnswerDisplayItem {
  event_id: string;
  event_title: string;
  question_key: string;
  label: string;
  type: CustomQuestionType;
  required: boolean;
  answer_text: string | null;
  answer_json: string | null;
  visibility: CustomQuestionVisibility;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  "text", "textarea", "select", "radio", "checkbox",
]);
const VALID_VISIBILITY: ReadonlySet<string> = new Set([
  "review", "private", "public",
]);
const KEY_MAX_LEN = 64;
const LABEL_MAX_LEN = 120;
const DESC_MAX_LEN = 1000;
const PLACEHOLDER_MAX_LEN = 1000;
const MAX_LENGTH_MAX = 5000;
const MAX_OPTIONS = 50;
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
      if (out.length >= MAX_OPTIONS) break;
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

interface QuestionDefinitionInput {
  question_key?: unknown;
  label?: unknown;
  description?: unknown;
  type?: unknown;
  required?: unknown;
  options_json?: unknown;
  placeholder?: unknown;
  max_length?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
  visibility?: unknown;
}

interface ValidatedQuestion {
  question_key: string;
  label: string;
  description: string | null;
  type: CustomQuestionType;
  required: boolean;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: boolean;
  visibility: CustomQuestionVisibility;
}

export function validateQuestionDefinition(
  input: QuestionDefinitionInput,
  index: number,
): ValidatedQuestion | { error: string } {
  const key = normalizeQuestionKey(input.question_key) || `q_${index}`;
  const label = typeof input.label === "string"
    ? input.label.trim().slice(0, LABEL_MAX_LEN)
    : "";
  if (!label) {
    return { error: `質問 ${index + 1}: ラベルは必須です。` };
  }

  const type = parseQuestionType(input.type);
  const description = typeof input.description === "string"
    ? input.description.trim().slice(0, DESC_MAX_LEN) || null
    : null;
  const placeholder = typeof input.placeholder === "string"
    ? input.placeholder.trim().slice(0, PLACEHOLDER_MAX_LEN) || null
    : null;

  let max_length: number | null = null;
  if (type === "text" || type === "textarea") {
    if (typeof input.max_length === "number" && input.max_length > 0) {
      max_length = Math.min(Math.floor(input.max_length), MAX_LENGTH_MAX);
    } else if (typeof input.max_length === "string" && input.max_length.trim()) {
      const n = Number(input.max_length);
      max_length = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LENGTH_MAX) : null;
    }
  }

  let options_json: string | null = null;
  if (type === "select" || type === "radio" || type === "checkbox") {
    const raw = typeof input.options_json === "string" ? input.options_json : null;
    const options = parseOptionsJson(raw);
    if (options.length === 0) {
      return { error: `${label}: 選択肢を1つ以上入力してください。` };
    }
    options_json = JSON.stringify(options);
  }

  const sort_order = typeof input.sort_order === "number"
    ? input.sort_order
    : typeof input.sort_order === "string" && input.sort_order.trim()
      ? Number(input.sort_order) || index
      : index;

  const is_active = input.is_active === true || input.is_active === 1 ||
    input.is_active === "1" || input.is_active === "true";

  return {
    question_key: key,
    label,
    description,
    type,
    required: input.required === true || input.required === 1 ||
      input.required === "1" || input.required === "true",
    options_json,
    placeholder,
    max_length,
    sort_order,
    is_active,
    visibility: parseVisibility(input.visibility),
  };
}

type AnswerValidationResult =
  | { ok: true; drafts: CustomAnswerDraft[] }
  | { ok: false; message: string };

export function validateAnswerInput(
  question: CustomQuestion,
  values: string[],
): AnswerValidationResult {
  const filtered = values.filter((v) => v.trim());

  if (question.required && filtered.length === 0) {
    return { ok: false, message: `${question.label}を入力してください。` };
  }

  if (filtered.length === 0) {
    return { ok: true, drafts: [] };
  }

  if (question.type === "text" || question.type === "textarea") {
    const value = filtered[0];
    const maxLen = question.max_length ?? (question.type === "text" ? 200 : 1000);
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
    if (question.options.length > 0 && !question.options.includes(value)) {
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
    for (const v of filtered) {
      if (question.options.length > 0 && !question.options.includes(v)) {
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
    for (const q of questions) {
      if (!q.is_active) continue;
      const name = `custom_answer:${eventId}:${q.question_key}`;
      const allValues = formData.getAll(name).map((v) =>
        typeof v === "string" ? v.trim() : ""
      ).filter(Boolean);

      const result = validateAnswerInput(q, allValues);
      if (!result.ok) {
        errors.push(result.message);
        continue;
      }
      drafts.push(...result.drafts);
    }
  }

  return { drafts, errors };
}

export function formatAnswerForDisplay(
  question: CustomQuestion,
  answer: CustomAnswerDraft | undefined,
): string {
  if (!answer) return "";
  if (question.type === "checkbox" && answer.answer_json) {
    try {
      const arr = JSON.parse(answer.answer_json) as unknown;
      if (Array.isArray(arr)) return arr.join(", ");
    } catch {
      return "";
    }
  }
  return answer.answer_text ?? "";
}

export function serializeAnswerForDb(
  question: CustomQuestion,
  value: string | string[],
): { answer_text: string | null; answer_json: string | null } {
  if (question.type === "checkbox" && Array.isArray(value)) {
    return { answer_text: null, answer_json: JSON.stringify(value) };
  }
  const text = Array.isArray(value) ? value[0] ?? "" : value;
  return { answer_text: text || null, answer_json: null };
}

export function deserializeAnswerFromDb(
  row: CustomAnswerRow,
): { answer_text: string | null; answer_json: string | null } {
  return {
    answer_text: row.answer_text,
    answer_json: row.answer_json,
  };
}
