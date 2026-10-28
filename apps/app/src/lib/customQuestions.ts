// Port of CURRENT src/lib/video/customQuestions.ts (MIG-0712).
// Only the DB-free question-type contract used by CustomQuestionFields. Do not import Drizzle schema here.
export type CustomQuestionType = "text" | "textarea" | "select" | "radio" | "checkbox";

export function questionTypeNeedsOptions(type: CustomQuestionType): boolean {
  return type === "select" || type === "radio" || type === "checkbox";
}
