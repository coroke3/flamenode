import {
  parseQuestionType,
  normalizeOptionList,
  type CustomQuestion,
  type CustomQuestionType,
} from "@/lib/video/customQuestions";
import { isStagePermissionQuestionKey } from "@/lib/video/formSettings";
import { generateId } from "@/lib/utils/id";

export type EventGeneralCustomQuestionDraft = {
  clientId: string;
  question_key: string;
  label: string;
  description: string;
  type: CustomQuestionType;
  required: boolean;
  options: string[];
  placeholder: string;
  enabled: boolean;
};

export const GENERAL_CUSTOM_QUESTION_TYPE_LABELS: Record<
  CustomQuestionType,
  string
> = {
  text: "短文",
  textarea: "長文",
  radio: "選択（ボタン）",
  checkbox: "チェックボックス",
  select: "プルダウン",
};

function createQuestionKeySuffix(): string {
  return generateId();
}

export function createEmptyGeneralCustomQuestion(
  index: number,
): EventGeneralCustomQuestionDraft {
  const suffix = createQuestionKeySuffix();
  return {
    clientId: `gq_${suffix}`,
    question_key: `q_${suffix}`,
    label: `カスタム質問 ${index + 1}`,
    description: "",
    type: "textarea",
    required: false,
    options: [],
    placeholder: "",
    enabled: true,
  };
}

export function customQuestionToDraft(
  question: CustomQuestion,
): EventGeneralCustomQuestionDraft {
  return {
    clientId: question.id,
    question_key: question.question_key,
    label: question.label,
    description: question.description ?? "",
    type: question.type,
    required: question.required,
    options: question.options,
    placeholder: question.placeholder ?? "",
    enabled: question.is_active,
  };
}

function boolFormValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function parseOptionsFromNewlineField(raw: string): string[] {
  return normalizeOptionList(raw.split(/\r?\n/));
}

export function generalCustomQuestionsPresent(formData: FormData): boolean {
  return String(formData.get("general_custom_questions_present") ?? "") === "1";
}

export function readGeneralCustomQuestionsFromFormData(
  formData: FormData,
): EventGeneralCustomQuestionDraft[] {
  if (!generalCustomQuestionsPresent(formData)) return [];

  const keys = formData.getAll("general_custom_question_key");
  const enabled = formData.getAll("general_custom_question_enabled");
  const required = formData.getAll("general_custom_question_required");
  const types = formData.getAll("general_custom_question_type");
  const labels = formData.getAll("general_custom_question_label");
  const descriptions = formData.getAll("general_custom_question_description");
  const placeholders = formData.getAll("general_custom_question_placeholder");
  const optionsRaw = formData.getAll("general_custom_question_options");

  return keys
    .map((rawKey, index): EventGeneralCustomQuestionDraft | null => {
      const question_key = String(rawKey ?? "").trim();
      if (!question_key || isStagePermissionQuestionKey(question_key)) {
        return null;
      }

      return {
        clientId: question_key,
        question_key,
        label: String(labels[index] ?? "").trim(),
        description: String(descriptions[index] ?? "").trim(),
        type: parseQuestionType(types[index]),
        required: boolFormValue(required[index]),
        options: parseOptionsFromNewlineField(String(optionsRaw[index] ?? "")),
        placeholder: String(placeholders[index] ?? "").trim(),
        enabled: boolFormValue(enabled[index]),
      };
    })
    .filter(
      (question): question is EventGeneralCustomQuestionDraft => question !== null,
    );
}
