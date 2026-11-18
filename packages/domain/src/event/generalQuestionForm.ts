/**
 * MIG-0652 U01 — framework-neutral CURRENT custom-question FormData reader.
 *
 * The caller injects the existing question-type, option normalization and
 * stage-key policy. This preserves CURRENT semantics without introducing a
 * Next/Drizzle import or a second incompatible normalization rule in domain.
 */
import type { GeneralQuestionPlannerType } from "./generalQuestionPlanner.ts";

export type GeneralQuestionFormDraft = {
  clientId: string;
  question_key: string;
  label: string;
  description: string;
  type: GeneralQuestionPlannerType;
  required: boolean;
  options: string[];
  placeholder: string;
  enabled: boolean;
};

export type GeneralQuestionFormAdapters = {
  parseQuestionType: (value: unknown) => GeneralQuestionPlannerType;
  normalizeOptionList: (options: readonly string[]) => string[];
  isStagePermissionQuestionKey: (key: string) => boolean;
};

function boolFormValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

export function generalCustomQuestionsPresentCore(
  formData: Pick<FormData, "get">,
): boolean {
  return String(formData.get("general_custom_questions_present") ?? "") === "1";
}

export function readGeneralCustomQuestionsFromFormDataCore(
  formData: Pick<FormData, "get" | "getAll">,
  adapters: GeneralQuestionFormAdapters,
): GeneralQuestionFormDraft[] {
  if (!generalCustomQuestionsPresentCore(formData)) return [];

  const keys = formData.getAll("general_custom_question_key");
  const enabled = formData.getAll("general_custom_question_enabled");
  const required = formData.getAll("general_custom_question_required");
  const types = formData.getAll("general_custom_question_type");
  const labels = formData.getAll("general_custom_question_label");
  const descriptions = formData.getAll("general_custom_question_description");
  const placeholders = formData.getAll("general_custom_question_placeholder");
  const optionsRaw = formData.getAll("general_custom_question_options");

  return keys
    .map((rawKey, index): GeneralQuestionFormDraft | null => {
      const question_key = String(rawKey ?? "").trim();
      if (!question_key || adapters.isStagePermissionQuestionKey(question_key)) {
        return null;
      }

      return {
        clientId: question_key,
        question_key,
        label: String(labels[index] ?? "").trim(),
        description: String(descriptions[index] ?? "").trim(),
        type: adapters.parseQuestionType(types[index]),
        required: boolFormValue(required[index]),
        options: adapters.normalizeOptionList(
          String(optionsRaw[index] ?? "").split(/\r?\n/),
        ),
        placeholder: String(placeholders[index] ?? "").trim(),
        enabled: boolFormValue(enabled[index]),
      };
    })
    .filter((question): question is GeneralQuestionFormDraft => question !== null);
}
