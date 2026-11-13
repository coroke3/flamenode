/**
 * MIG-0652 U02 — pure event-create custom-question selection and D1 chunk planning.
 * CURRENT src/lib/actions/event-admin.ts#createEvent owns parsing, ID generation,
 * template conversion, auth, D1 atomic mutation/audit, R2 and Queue side effects.
 *
 * Preserve CURRENT validation order, error messages and 6-row insert chunks.
 */
import { MAX_STAGE_PERMISSION_QUESTIONS } from "./limits.ts";
import { resolveGeneralCustomQuestionCap } from "./generalQuestionCap.ts";

export const MAX_EVENT_CREATE_QUESTIONS = 18;
export const MAX_EVENT_CREATE_QUESTIONS_PER_INSERT = 6;

export type EventCreateQuestionInput<T extends { question_key: string }> =
  | { present: false }
  | {
    present: true;
    planned:
      | { ok: true; rows: readonly T[] }
      | { ok: false; message: string };
  };

/**
 * No queries, DB calls, random IDs or FormData reads occur here. The caller
 * supplies normalized and fully planned rows (with host-generated IDs).
 */
export function planEventCreateQuestionBatch<T extends { question_key: string }>(input: {
  templateGeneralQuestions: readonly T[];
  submittedGeneral: EventCreateQuestionInput<T>;
  stageQuestions: readonly T[];
}):
  | { ok: false; message: string }
  | { ok: true; questions: T[]; chunks: T[][] } {
  let generalQuestions = [...input.templateGeneralQuestions];

  if (input.submittedGeneral.present) {
    const planned = input.submittedGeneral.planned;
    if (!planned.ok) return { ok: false, message: planned.message };
    const cap = resolveGeneralCustomQuestionCap({
      existingCount: 0,
      templateCount: input.templateGeneralQuestions.length,
    });
    if (planned.rows.length > cap) {
      return { ok: false, message: `カスタム質問は最大${cap}件です。` };
    }
    generalQuestions = [...planned.rows];
  }

  if (input.stageQuestions.length > MAX_STAGE_PERMISSION_QUESTIONS) {
    return {
      ok: false,
      message: `ステージ・権利確認質問は最大${MAX_STAGE_PERMISSION_QUESTIONS}件です。`,
    };
  }

  const questions = [...generalQuestions, ...input.stageQuestions];
  if (questions.length > MAX_EVENT_CREATE_QUESTIONS) {
    return {
      ok: false,
      message: `カスタム質問はステージ質問を含めて最大${MAX_EVENT_CREATE_QUESTIONS}件です。`,
    };
  }
  if (new Set(questions.map((row) => row.question_key)).size !== questions.length) {
    return { ok: false, message: "カスタム質問の識別子が重複しています。" };
  }

  const chunks: T[][] = [];
  for (let index = 0; index < questions.length; index += MAX_EVENT_CREATE_QUESTIONS_PER_INSERT) {
    chunks.push(questions.slice(index, index + MAX_EVENT_CREATE_QUESTIONS_PER_INSERT));
  }
  return { ok: true, questions, chunks };
}
