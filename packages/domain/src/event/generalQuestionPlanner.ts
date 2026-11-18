/**
 * Framework-neutral general-question insert planning (MIG-0652 U01).
 * Normalize and validate before the D1 batch; ID generation is host-injected.
 * Scalar helpers reproduce CURRENT src/lib/video/customQuestions.ts and
 * src/lib/video/formSettings.ts without importing server-only dependencies.
 */
export type GeneralQuestionPlannerType = "text" | "textarea" | "radio" | "checkbox" | "select";
export type GeneralQuestionPlanningDraft = {
  question_key: string;
  label: string;
  description: string;
  type: GeneralQuestionPlannerType;
  required: boolean;
  options: string[];
  placeholder: string;
  enabled: boolean;
};
export type PlannedGeneralQuestionRow = {
  id: string; event_id: string; question_key: string;
  label: string; description: string | null;
  type: GeneralQuestionPlannerType; required: number;
  options_json: string | null; placeholder: string | null;
  max_length: number | null; sort_order: number;
  is_active: number; visibility: "review"; created_at: number; updated_at: number;
};
const VALID_TYPES: ReadonlySet<string> = new Set(["text", "textarea", "select", "radio", "checkbox"]);
function normalizeQuestionKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}
function isStagePermissionQuestionKey(key: string): boolean {
  return key === "stage_permission" || key.startsWith("stage_permission_");
}
function parseQuestionType(value: unknown): GeneralQuestionPlannerType {
  if (typeof value === "string" && VALID_TYPES.has(value)) return value as GeneralQuestionPlannerType;
  return "textarea";
}
function questionTypeNeedsOptions(type: GeneralQuestionPlannerType): boolean {
  return type === "select" || type === "radio" || type === "checkbox";
}
function parseOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const clipped = item.trim().slice(0, 200);
      // CURRENT drops a high surrogate left orphaned by UTF-16 truncation.
      const trimmed = /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= 50) break;
    }
    return out;
  } catch {
    return [];
  }
}
function serializeOptionsJson(options: readonly string[] | null | undefined): string | null {
  const normalized = parseOptionsJson(JSON.stringify(options ?? []));
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function plannedGeneralQuestionsFromDraftsCore(args: {
  eventId: string;
  drafts: readonly GeneralQuestionPlanningDraft[];
  now: number;
  createId: () => string;
}):
  | { ok: true; rows: PlannedGeneralQuestionRow[] }
  | { ok: false; message: string } {
  const rows: PlannedGeneralQuestionRow[] = [];
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
      id: args.createId(),
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
