import {
  normalizeQuestionKey,
  parseQuestionType,
  parseVisibility,
  type CustomQuestionType,
  type CustomQuestionVisibility,
} from "@/lib/video/customQuestions";
import {
  MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH,
  MAX_CUSTOM_QUESTION_LABEL_LENGTH,
  MAX_CUSTOM_QUESTION_OPTIONS,
  MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH,
  MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH,
  MAX_CUSTOM_QUESTION_TEXT_LENGTH,
  MAX_EVENT_CUSTOM_QUESTIONS,
} from "@/lib/video/customQuestionLimits";

export interface SubmittedCustomQuestionDefinition {
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

export type ReadCustomQuestionDefinitionsResult =
  | { ok: true; submitted: false; definitions: [] }
  | { ok: true; submitted: true; definitions: SubmittedCustomQuestionDefinition[] }
  | { ok: false; submitted: true; message: string };

function boolValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function cleanText(
  value: FormDataEntryValue | undefined,
  maxLength: number,
): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseOptionsText(raw: FormDataEntryValue | undefined): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const option = line.trim().slice(0, 200);
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (options.length >= MAX_CUSTOM_QUESTION_OPTIONS) break;
  }
  return options;
}

function parseMaxLength(
  raw: FormDataEntryValue | undefined,
  type: CustomQuestionType,
): number | null {
  if (type !== "text" && type !== "textarea") return null;
  const fallback = type === "text"
    ? MAX_CUSTOM_QUESTION_TEXT_LENGTH
    : MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(5000, parsed));
}

export function readCustomQuestionDefinitions(
  formData: FormData,
): ReadCustomQuestionDefinitionsResult {
  const submitted = String(formData.get("custom_questions_present") ?? "") === "1";
  if (!submitted) return { ok: true, submitted: false, definitions: [] };

  const keys = formData.getAll("custom_question_key");
  if (keys.length > MAX_EVENT_CUSTOM_QUESTIONS) {
    return {
      ok: false,
      submitted: true,
      message: `カスタム質問は最大${MAX_EVENT_CUSTOM_QUESTIONS}件です。`,
    };
  }

  const active = formData.getAll("custom_question_active");
  const required = formData.getAll("custom_question_required");
  const labels = formData.getAll("custom_question_label");
  const descriptions = formData.getAll("custom_question_description");
  const types = formData.getAll("custom_question_type");
  const options = formData.getAll("custom_question_options");
  const placeholders = formData.getAll("custom_question_placeholder");
  const maxLengths = formData.getAll("custom_question_max_length");
  const visibilities = formData.getAll("custom_question_visibility");

  const seen = new Set<string>();
  const definitions: SubmittedCustomQuestionDefinition[] = [];

  for (let index = 0; index < keys.length; index += 1) {
    const questionKey = normalizeQuestionKey(keys[index]);
    const label = cleanText(labels[index], MAX_CUSTOM_QUESTION_LABEL_LENGTH);
    if (!questionKey) {
      return {
        ok: false,
        submitted: true,
        message: `質問${index + 1}の識別子を入力してください。`,
      };
    }
    if (!label) {
      return {
        ok: false,
        submitted: true,
        message: `質問${index + 1}の質問名を入力してください。`,
      };
    }
    if (seen.has(questionKey)) {
      return {
        ok: false,
        submitted: true,
        message: `カスタム質問の識別子「${questionKey}」が重複しています。`,
      };
    }
    seen.add(questionKey);

    const type = parseQuestionType(types[index]);
    const parsedOptions = parseOptionsText(options[index]);
    if (
      (type === "select" || type === "radio" || type === "checkbox") &&
      parsedOptions.length === 0
    ) {
      return {
        ok: false,
        submitted: true,
        message: `「${label}」には1件以上の選択肢が必要です。`,
      };
    }

    definitions.push({
      question_key: questionKey,
      label,
      description:
        cleanText(descriptions[index], MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH) || null,
      type,
      required: boolValue(required[index]),
      options_json: parsedOptions.length > 0 ? JSON.stringify(parsedOptions) : null,
      placeholder:
        cleanText(placeholders[index], MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH) || null,
      max_length: parseMaxLength(maxLengths[index], type),
      sort_order: index,
      is_active: boolValue(active[index]),
      visibility: parseVisibility(visibilities[index]),
    });
  }

  return { ok: true, submitted: true, definitions };
}
