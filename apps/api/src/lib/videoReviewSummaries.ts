// MIG-0624 (shared with MIG-0625 admin videos): port of CURRENT src/lib/admin/videoReviewMeta.ts
// (fetchVideoReviewSummaries) and src/lib/video/stagePermissionAnswers.ts (batchReadStagePermissionCustomAnswers,
// stagePermissionQuestionKeyCondition) + formSettings.ts (serializeStagePermissionAnswers).
//
// CURRENT runs 2 + N chunked D1 reads per page. Here the two review columns are correlated subqueries that are added to
// the SELECT list of the caller's own video list statement, so they cost no extra D1 statement:
//   reviewSummarySql("v.id", eventId?)  -> { sql, params } with columns `stage_questions` (JSON) and `required_missing`
//   finishReviewSummary(row)            -> { stage_permission_summary, required_unanswered_count }
// The video list itself must be bounded by the caller (<= 100 rows, ZERO_1102 S2).

const DEFAULT_STAGE_PERMISSION_QUESTION_KEY = "stage_permission";
const DEFAULT_STAGE_PERMISSION_LABEL = "ステージ・素材・権利まわりの使用許可";
/** CURRENT MAX_STAGE_PERMISSION_QUESTIONS (src/lib/event/eventLimits.ts). */
const MAX_STAGE_PERMISSION_QUESTIONS = 4;

export interface ReviewSummarySql {
  sql: string;
  params: unknown[];
}

export interface ReviewSummaryRow {
  /** JSON text produced by reviewSummarySql (or already parsed). */
  stage_questions: string | StageQuestion[] | null;
  required_missing: number | null;
}

export interface StageQuestion {
  event_id: string;
  question_key: string;
  label: string;
  sort_order: number;
  is_active: number;
  answer: string | null;
}

export interface VideoReviewSummary {
  stage_permission_summary: string;
  required_unanswered_count: number;
}

/**
 * Correlated subqueries for one video id expression (e.g. "v.id"). `eventId` limits both columns to one event
 * (CURRENT passes the manage event); without it all events linked through video_events are used.
 * The returned SQL is two select-list items: `... AS stage_questions, ... AS required_missing`.
 */
export function reviewSummarySql(videoIdExpr: string, eventId?: string): ReviewSummarySql {
  const eventScope = eventId ? " AND ve.event_id = ?" : "";
  const params: unknown[] = [];
  const scoped = (): void => {
    if (eventId) params.push(eventId);
  };
  // stage permission questions (CURRENT stagePermissionQuestionKeyCondition), limit 5 to detect "> 4"
  scoped();
  const stage = `(SELECT json_group_array(json_object('event_id', q.event_id, 'question_key', q.question_key, 'label', q.label,
        'sort_order', q.sort_order, 'is_active', q.is_active, 'answer', q.answer)) FROM (
      SELECT c.event_id AS event_id, c.question_key AS question_key, c.label AS label, c.sort_order AS sort_order,
        c.is_active AS is_active,
        (SELECT a.answer_text FROM video_custom_answers a
          WHERE a.video_id = ${videoIdExpr} AND a.event_id = c.event_id AND a.question_id = c.id LIMIT 1) AS answer
      FROM event_custom_questions c
      WHERE c.event_id IN (SELECT ve.event_id FROM video_events ve WHERE ve.video_id = ${videoIdExpr}${eventScope})
        AND (c.question_key = '${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}'
          OR substr(c.question_key, 1, ${DEFAULT_STAGE_PERMISSION_QUESTION_KEY.length + 1}) = '${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}_')
      ORDER BY c.event_id ASC, c.sort_order ASC, c.id ASC
      LIMIT ${MAX_STAGE_PERMISSION_QUESTIONS + 1}) q) AS stage_questions`;
  // required, active questions of the video's events without a non-empty answer (CURRENT missingRows)
  scoped();
  const missing = `(SELECT COUNT(DISTINCT rq.id) FROM video_events ve
      INNER JOIN event_custom_questions rq ON rq.event_id = ve.event_id AND rq.is_active = 1 AND rq.required = 1
      LEFT JOIN video_custom_answers ra ON ra.video_id = ve.video_id AND ra.question_id = rq.id AND (
        trim(coalesce(ra.answer_text, '')) <> ''
        OR (trim(coalesce(ra.answer_json, '')) <> ''
          AND trim(coalesce(ra.answer_json, '')) NOT IN ('[]', '{}', 'null', '""')))
      WHERE ve.video_id = ${videoIdExpr}${eventScope} AND ra.video_id IS NULL) AS required_missing`;
  return { sql: `${stage}, ${missing}`, params };
}

function cleanId(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned || fallback;
}

function cleanText(value: string, fallback: string): string {
  return value.trim() ? value.trim() : fallback;
}

/** CURRENT serializeStagePermissionAnswers over the active questions (event order, then sort_order). */
function serializeStagePermission(questions: readonly StageQuestion[]): string | null {
  const cleaned = questions
    .filter((q) => q.is_active === 1)
    .map((q) => ({
      id: cleanId(q.question_key, ""),
      label: cleanText(q.label, DEFAULT_STAGE_PERMISSION_LABEL),
      value: (q.answer ?? "").trim(),
    }))
    .filter((a) => a.id && a.value);
  if (cleaned.length === 0) return null;
  return JSON.stringify({ version: 1, answers: cleaned });
}

function summarizeStagePermission(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "未入力";
  if (text.length <= 24) return text;
  return `${text.slice(0, 23)}…`;
}

/**
 * Stage permission JSON (CURRENT batchReadStagePermissionCustomAnswers value, also used by the video detail page).
 * Throws like CURRENT when more than 4 stage questions apply to the video (-> 503 in the routes).
 */
export function stagePermissionJson(row: Pick<ReviewSummaryRow, "stage_questions">): string | null {
  const questions: StageQuestion[] =
    typeof row.stage_questions === "string"
      ? (JSON.parse(row.stage_questions) as StageQuestion[])
      : (row.stage_questions ?? []);
  if (questions.length > MAX_STAGE_PERMISSION_QUESTIONS) throw new Error("video_stage_answer_read_limit_exceeded");
  return serializeStagePermission(questions);
}

/** CURRENT VideoReviewSummary for one list row. */
export function finishReviewSummary(row: ReviewSummaryRow): VideoReviewSummary {
  return {
    stage_permission_summary: summarizeStagePermission(stagePermissionJson(row)),
    required_unanswered_count: Number(row.required_missing ?? 0),
  };
}
