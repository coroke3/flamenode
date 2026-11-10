/** MIG-0721 U01b-2: CURRENT custom-question display contract only.
 * Edit/create serializers remain owned by the EventForm U01b-3 unit.
 * Types and labels copied without changes from src/lib/event/generalCustomQuestionDraft.ts.
 */
type CustomQuestionType = "text" | "textarea" | "radio" | "checkbox" | "select";
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

