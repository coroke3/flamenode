import type { EntryCustomQuestion } from "@flamenode/contracts";

// CURRENT: src/lib/video/customQuestions.ts (rowToQuestion and its parsers), src/lib/video/customQuestionAnswers.ts
// (MAX_VIDEO_CUSTOM_QUESTIONS_READ, fetchActiveCustomQuestionsForEvents limits), src/lib/video/formSettings.ts and
// stagePermissionAnswers.ts (stage-permission key), stagePermissionQuestions.ts (settings JSON). Copied; parity-tested.

/** Per-event business limit; a larger event fails like CURRENT (throws -> 503). */
export const MAX_VIDEO_CUSTOM_QUESTIONS_READ = 18;
const MAX_OPTIONS = 50;
const OPTION_MAX_LEN = 200;
export const STAGE_PERMISSION_QUESTION_KEY = "stage_permission";
export const STAGE_PERMISSION_KEY_PREFIX = `${STAGE_PERMISSION_QUESTION_KEY}_`;

/** SQL twin of CURRENT stagePermissionQuestionKeyCondition() on event_custom_questions.question_key. */
export const STAGE_PERMISSION_KEY_SQL = `(question_key = '${STAGE_PERMISSION_QUESTION_KEY}' OR substr(question_key, 1, ${STAGE_PERMISSION_KEY_PREFIX.length}) = '${STAGE_PERMISSION_KEY_PREFIX}')`;

export interface CustomQuestionRow {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: string | null;
  required: number | null;
  options_json: string | null;
  placeholder: string | null;
  max_length: number | null;
  sort_order: number | null;
  is_active: number | null;
  visibility: string | null;
}

function parseOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim().slice(0, OPTION_MAX_LEN);
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_OPTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

const TYPES = new Set(["text", "textarea", "select", "radio", "checkbox"]);
const VISIBILITIES = new Set(["review", "private", "public"]);

export function rowToQuestion(row: CustomQuestionRow): EntryCustomQuestion {
  return {
    id: row.id,
    event_id: row.event_id,
    question_key: row.question_key,
    label: row.label,
    description: row.description ?? null,
    type: (typeof row.type === "string" && TYPES.has(row.type) ? row.type : "textarea") as EntryCustomQuestion["type"],
    required: row.required === 1,
    options: parseOptionsJson(row.options_json),
    placeholder: row.placeholder ?? null,
    max_length: row.max_length ?? null,
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active === 1,
    visibility: (typeof row.visibility === "string" && VISIBILITIES.has(row.visibility)
      ? row.visibility
      : "review") as EntryCustomQuestion["visibility"],
  };
}

/** CURRENT fetchActiveCustomQuestionsForEvents' result and limit assertions, over rows already read in order. */
export function groupCustomQuestions(
  rows: readonly CustomQuestionRow[],
  eventIds: readonly string[],
): Map<string, EntryCustomQuestion[]> {
  const uniqueIds = new Set(eventIds.filter(Boolean));
  if (rows.length > Math.max(1, uniqueIds.size) * MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }
  const out = new Map<string, EntryCustomQuestion[]>();
  for (const row of rows) {
    const list = out.get(row.event_id) ?? [];
    if (list.length >= MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
      throw new Error("video_custom_question_read_limit_exceeded");
    }
    list.push(rowToQuestion(row));
    out.set(row.event_id, list);
  }
  return out;
}

export interface StageQuestionRow {
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: number | null;
  is_active: number | null;
}

/** CURRENT loadStagePermissionFormSettingsJsonByEvents (rows already ordered by event_id, sort_order). */
export function stageSettingsJsonByEvent(rows: readonly StageQuestionRow[]): Map<string, string> {
  const grouped = new Map<string, StageQuestionRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.event_id) ?? [];
    list.push(row);
    grouped.set(row.event_id, list);
  }
  const out = new Map<string, string>();
  for (const [eventId, list] of grouped) {
    out.set(
      eventId,
      JSON.stringify({
        stage_permissions: list.map((row) => ({
          id: row.question_key,
          enabled: row.is_active === 1,
          required: row.required === 1,
          label: row.label,
          description: row.description ?? "",
          placeholder: row.placeholder ?? "",
        })),
      }),
    );
  }
  return out;
}

/** Column list shared by the SQL arms (json_object keys == CustomQuestionRow fields). */
export const CUSTOM_QUESTION_COLUMNS = [
  "id",
  "event_id",
  "question_key",
  "label",
  "description",
  "type",
  "required",
  "options_json",
  "placeholder",
  "max_length",
  "sort_order",
  "is_active",
  "visibility",
] as const;
