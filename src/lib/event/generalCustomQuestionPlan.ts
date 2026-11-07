import type { eventCustomQuestions } from "@/lib/db/schema";
import type { EventGeneralCustomQuestionDraft } from "@/lib/event/generalCustomQuestionDraft";
import { generateId } from "@/lib/utils/id";
import { plannedGeneralQuestionsFromDraftsCore } from "@flamenode/domain/event";

export type PlannedCustomQuestion = typeof eventCustomQuestions.$inferInsert;

export { resolveGeneralCustomQuestionCap } from "@flamenode/domain/event";

/** CURRENT insert typing and ID factory are retained at the Next integration boundary. */
export function plannedGeneralQuestionsFromDrafts(args: {
  eventId: string;
  drafts: readonly EventGeneralCustomQuestionDraft[];
  now: number;
}):
  | { ok: true; rows: PlannedCustomQuestion[] }
  | { ok: false; message: string } {
  return plannedGeneralQuestionsFromDraftsCore({
    ...args,
    createId: () => generateId("ecq"),
  });
}
