import {
  parseQuestionType,
  normalizeOptionList,
  type CustomQuestionType,
} from "@/lib/video/customQuestions";
import { isStagePermissionQuestionKey } from "@/lib/video/formSettings";
import { generateId } from "@/lib/utils/id";
import {
  generalCustomQuestionsPresentCore,
  readGeneralCustomQuestionsFromFormDataCore,
} from "@flamenode/domain/event";

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

export { customQuestionToDraft } from "@flamenode/domain/event";

/** CURRENT import signatures remain unchanged; pure FormData reading lives in domain. */
export function generalCustomQuestionsPresent(formData: FormData): boolean {
  return generalCustomQuestionsPresentCore(formData);
}

export function readGeneralCustomQuestionsFromFormData(
  formData: FormData,
): EventGeneralCustomQuestionDraft[] {
  return readGeneralCustomQuestionsFromFormDataCore(formData, {
    parseQuestionType,
    normalizeOptionList,
    isStagePermissionQuestionKey,
  });
}
