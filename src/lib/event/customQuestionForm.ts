import type {
  CustomQuestionType,
  CustomQuestionVisibility,
} from "@/lib/video/customQuestions";
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

const QUESTION_TYPES = new Set<CustomQuestionType>([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
]);
const QUESTION_VISIBILITIES = new Set<CustomQuestionVisibility>([
  "review",
  "private",
  "public",
]);
const QUESTION_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function boolValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function textValue(value: FormDataEntryValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(
  value: FormDataEntryValue | undefined,
  maxLength: number,
  label: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const text = textValue(value);
  if (text.length > maxLength) {
    return { ok: false, message: `${label}は${maxLength}文字以内で入力してください。` };
  }
  return { ok: true, value: text };
}

function parseQuestionType(
  value: FormDataEntryValue | undefined,
): CustomQuestionType | null {
  const type = textValue(value) as CustomQuestionType;
  return QUESTION_TYPES.has(type) ? type : null;
}

function parseVisibility(
  value: FormDataEntryValue | undefined,
): CustomQuestionVisibility | null {
  const visibility = textValue(value) as CustomQuestionVisibility;
  return QUESTION_VISIBILITIES.has(visibility) ? visibility : null;
}

function parseOptionsText(
  raw: FormDataEntryValue | undefined,
  label: string,
): { ok: true; options: string[] } | { ok: false; message: string } {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const option = rawLine.trim();
    if (!option || seen.has(option)) continue;
    if (option.length > MAX_CUSTOM_QUESTION_OPTION_LENGTH) {
      return {
        ok: false,
        message: `「${label}」の選択肢は1件${MAX_CUSTOM_QUESTION_OPTION_LENGTH}文字以内で入力してください。`,
      };
    }
    if (options.length >= MAX_CUSTOM_QUESTION_OPTIONS) {
      return {
        ok: false,
        message: `「${label}」の選択肢は最大${MAX_CUSTOM_QUESTION_OPTIONS}件です。`,
      };
    }
    seen.add(option);
    options.push(option);
  }
  return { ok: true, options };
}

function parseMaxLength(
  raw: FormDataEntryValue | undefined,
  type: CustomQuestionType,
  label: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (type !== "text" && type !== "textarea") {
    return { ok: true, value: null };
  }
  const fallback = type === "text"
    ? MAX_CUSTOM_QUESTION_TEXT_LENGTH
    : MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH;
  const text = textValue(raw);
  if (!text) return { ok: true, value: fallback };
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: `「${label}」の最大文字数が不正です。` };
  }
  const parsed = Number(text);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH
  ) {
    return {
      ok: false,
      message: `「${label}」の最大文字数は1〜${MAX_CUSTOM_QUESTION_CONFIGURED_LENGTH}で指定してください。`,
    };
  }
  return { ok: true, value: parsed };
}

function hasAlignedQuestionFields(
  expectedLength: number,
  fields: readonly FormDataEntryValue[][],
): boolean {
  return fields.every((field) => field.length === expectedLength);
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

  if (!hasAlignedQuestionFields(keys.length, [
    active,
    required,
    labels,
    descriptions,
    types,
    options,
    placeholders,
    maxLengths,
    visibilities,
  ])) {
    return {
      ok: false,
      submitted: true,
      message: "カスタム質問の送信データが不正です。画面を再読み込みしてください。",
    };
  }

  const seen = new Set<string>();
  const definitions: SubmittedCustomQuestionDefinition[] = [];

  for (let index = 0; index < keys.length; index += 1) {
    const position = `質問${index + 1}`;
    const questionKey = textValue(keys[index]);
    if (!questionKey) {
      return { ok: false, submitted: true, message: `${position}の識別子を入力してください。` };
    }
    if (
      questionKey.length > MAX_CUSTOM_QUESTION_KEY_LENGTH ||
      !QUESTION_KEY_PATTERN.test(questionKey)
    ) {
      return {
        ok: false,
        submitted: true,
        message: `${position}の識別子は半角英数字・_・-のみ、${MAX_CUSTOM_QUESTION_KEY_LENGTH}文字以内で入力してください。`,
      };
    }
    if (seen.has(questionKey)) {
      return {
        ok: false,
        submitted: true,
        message: `カスタム質問の識別子「${questionKey}」が重複しています。`,
      };
    }

    const labelResult = boundedText(
      labels[index],
      MAX_CUSTOM_QUESTION_LABEL_LENGTH,
      `${position}の質問名`,
    );
    if (!labelResult.ok) return { ok: false, submitted: true, message: labelResult.message };
    if (!labelResult.value) {
      return { ok: false, submitted: true, message: `${position}の質問名を入力してください。` };
    }
    const label = labelResult.value;

    const descriptionResult = boundedText(
      descriptions[index],
      MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH,
      `「${label}」の補足文`,
    );
    if (!descriptionResult.ok) {
      return { ok: false, submitted: true, message: descriptionResult.message };
    }
    const placeholderResult = boundedText(
      placeholders[index],
      MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH,
      `「${label}」の入力例・案内`,
    );
    if (!placeholderResult.ok) {
      return { ok: false, submitted: true, message: placeholderResult.message };
    }

    const type = parseQuestionType(types[index]);
    if (!type) {
      return { ok: false, submitted: true, message: `「${label}」の回答形式が不正です。` };
    }
    const visibility = parseVisibility(visibilities[index]);
    if (!visibility) {
      return { ok: false, submitted: true, message: `「${label}」の公開範囲が不正です。` };
    }

    const optionsResult = parseOptionsText(options[index], label);
    if (!optionsResult.ok) {
      return { ok: false, submitted: true, message: optionsResult.message };
    }
    const usesOptions = type === "select" || type === "radio" || type === "checkbox";
    if (usesOptions && optionsResult.options.length === 0) {
      return {
        ok: false,
        submitted: true,
        message: `「${label}」には1件以上の選択肢が必要です。`,
      };
    }

    const maxLengthResult = parseMaxLength(maxLengths[index], type, label);
    if (!maxLengthResult.ok) {
      return { ok: false, submitted: true, message: maxLengthResult.message };
    }

    seen.add(questionKey);
    definitions.push({
      question_key: questionKey,
      label,
      description: descriptionResult.value || null,
      type,
      required: boolValue(required[index]),
      options_json: usesOptions ? JSON.stringify(optionsResult.options) : null,
      placeholder: placeholderResult.value || null,
      max_length: maxLengthResult.value,
      sort_order: index,
      is_active: boolValue(active[index]),
      visibility,
    });
  }

  return { ok: true, submitted: true, definitions };
}
