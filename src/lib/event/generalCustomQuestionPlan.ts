import type { eventCustomQuestions } from "@/lib/db/schema";
import { MAX_GENERAL_CUSTOM_QUESTIONS } from "@/lib/event/eventLimits";
import type { EventGeneralCustomQuestionDraft } from "@/lib/event/generalCustomQuestionDraft";
import { generateId } from "@/lib/utils/id";
import { isStagePermissionQuestionKey } from "@/lib/video/formSettings";
import {
  normalizeQuestionKey,
  parseQuestionType,
  questionTypeNeedsOptions,
  serializeOptionsJson,
} from "@/lib/video/customQuestions";

export type PlannedCustomQuestion = typeof eventCustomQuestions.$inferInsert;

export function resolveGeneralCustomQuestionCap(args: {
  existingCount: number;
  templateCount: number;
}): number {
  return Math.max(
    MAX_GENERAL_CUSTOM_QUESTIONS,
    args.existingCount,
    args.templateCount,
  );
}

export function plannedGeneralQuestionsFromDrafts(args: {
  eventId: string;
  drafts: readonly EventGeneralCustomQuestionDraft[];
  now: number;
}):
  | { ok: true; rows: PlannedCustomQuestion[] }
  | { ok: false; message: string } {
  const rows: PlannedCustomQuestion[] = [];
  const seen = new Set<string>();

  for (const [index, draft] of args.drafts.entries()) {
    const key = normalizeQuestionKey(draft.question_key);
    if (!key) {
      return { ok: false, message: "カスタム質問の識別子が不正です。" };
    }
    if (isStagePermissionQuestionKey(key)) {
      return {
        ok: false,
        message: "カスタム質問の識別子がステージ質問と衝突しています。",
      };
    }
    if (seen.has(key)) {
      return { ok: false, message: "カスタム質問の識別子が重複しています。" };
    }
    seen.add(key);

    const label = draft.label.trim().slice(0, 120);
    if (!label) {
      return { ok: false, message: "カスタム質問の質問名を入力してください。" };
    }

    const type = parseQuestionType(draft.type);
    const optionsJson = questionTypeNeedsOptions(type)
      ? serializeOptionsJson(draft.options)
      : null;
    if (questionTypeNeedsOptions(type) && !optionsJson) {
      return {
        ok: false,
        message: `${label}の選択肢を1件以上入力してください。`,
      };
    }

    rows.push({
      id: generateId("ecq"),
      event_id: args.eventId,
      question_key: key,
      label,
      description: draft.description.trim().slice(0, 1000) || null,
      type,
      required: draft.required ? 1 : 0,
      options_json: optionsJson,
      placeholder: draft.placeholder.trim().slice(0, 500) || null,
      max_length:
        type === "text" ? 200 : type === "textarea" ? 1000 : null,
      sort_order: index,
      is_active: draft.enabled ? 1 : 0,
      visibility: "review",
      created_at: args.now,
      updated_at: args.now,
    });
  }

  return { ok: true, rows };
}
