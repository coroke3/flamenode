/**
 * Framework-neutral projection of an existing custom question into the
 * editable event-question draft shape. Preserve strings, booleans and the
 * original options array; CURRENT does not clone or normalize here.
 */
type GeneralQuestionDraftSource = {
  id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: "text" | "textarea" | "select" | "radio" | "checkbox";
  required: boolean;
  options: string[];
  placeholder: string | null;
  is_active: boolean;
};

export function customQuestionToDraft(question: GeneralQuestionDraftSource) {
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
