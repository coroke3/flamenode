import { Hono } from "hono";
import type { EditFormOptionsResponse, SlottedEventOption } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { approvedXIdsOf, loadPersonalContext } from "../context.ts";
import { channelCandidatesOf, iconCandidatesOf, softwareSuggestionsOf } from "../entry/formData.ts";
import {
  groupCustomQuestions,
  stageSettingsJsonByEvent,
  STAGE_PERMISSION_KEY_SQL,
  type CustomQuestionRow,
  type StageQuestionRow,
} from "../entry/customQuestions.ts";
import {
  armOf,
  assertResponseBytes,
  ENTRY_PAGE_ROWS,
  jsonBytes,
  MAX_RESPONSE_BYTES,
  nestedRows,
  nextOffsetOf,
  parseOffset,
  takeWithinBytes,
  type ArmRows,
} from "../entry/rows.ts";
import { candidateArms, customQuestionArm, softwareArms, stageQuestionArm } from "../entry/sql.ts";
import { buildAccessContext, decideEditPage, normalizePrivilegeMode, pageEventIds } from "./access.ts";
import { approvedIdsJson, editDataOf, editStatementSql, parseDataRows, type VideoRow } from "./data.ts";

// CURRENT: app/(auth)/dashboard/edit/[id]/page.tsx (the part that feeds VideoForm besides the video's own values):
// acceptingEntriesWhere events + attached events with their stage settings and active custom questions, the video's custom
// answers (the D1_VIDEO_ANSWER_ID_CHUNK_SIZE chunks become one JOIN arm), readStagePermissionCustomAnswers,
// getUsedSoftwareSuggestions, getXIconCandidates, getYoutubeChannelCandidates. GET only: nothing is written.
// D1 (S2, 3 statements incl. the session lookup): context = 1, then ONE data statement = the access arms of
// GET /api/personal/edit/:id (the gate) + the form arms below. Binds: ?1 video id, ?2 approved X IDs (JSON), ?3 now, ?4 offset.

/** CURRENT readStagePermissionCustomAnswers: more than MAX_STAGE_PERMISSION_QUESTIONS (4) questions or answers throws (-> 503). */
const MAX_STAGE_ANSWER_ROWS = 4;
/** Custom answer rows of the video (CURRENT: one row per question, unbounded). One extra row detects a cut. */
export const MAX_FORM_CUSTOM_ANSWERS = 100;
/** Attached events listed with the options (CURRENT: unbounded; same cap as MAX_EDIT_EVENTS). */
const MAX_FORM_ATTACHED_EVENTS = 100;
/**
 * Every arm is bounded: access arms 204 (video 1, vevent 100, staff 100, mine 1, pol 2) + accepting 100 + attached 100
 * + questions 200 + stage settings 200 + answers 101 + stage question / answer rows 10 + software 160 + icon 49 + channel 49.
 */
const MAX_FORM_ROWS = 1200;

interface OptionRow {
  id: string;
  title: string;
  parts_json: string | null;
  youtube_description_template: string | null;
  required_video_fields_json: string | null;
}
interface AnswerRow {
  event_id: string;
  question_key: string;
  answer_text: string | null;
  answer_json: string | null;
}
interface StageQuestion {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  sort_order: number;
  is_active: number;
}

const OPTION_COLUMNS =
  "events.id AS id, events.title AS title, events.parts_json AS parts_json, events.youtube_description_template AS youtube_description_template, events.required_video_fields_json AS required_video_fields_json";
const optionObject = (alias: string) =>
  `json_object('id', ${alias}.id, 'title', ${alias}.title, 'parts_json', ${alias}.parts_json, 'youtube_description_template', ${alias}.youtube_description_template, 'required_video_fields_json', ${alias}.required_video_fields_json)`;

/**
 * The form-only part of the data statement (see editStatementSql("form")).
 * acc = acceptingEntriesWhere(now) AND allow_user_video_event_links = 1 (CURRENT has no ORDER BY; id makes the page deterministic).
 * att = the events the video is attached to (video_events + primary), whatever their status; first page only.
 * stq = CURRENT readStagePermissionCustomAnswers' stage questions of the attached events (limit 4 + 1 to detect the throw).
 */
function formExtra() {
  const questions = customQuestionArm("opt");
  const stage = stageQuestionArm("opt");
  return {
    ctes: `ax AS (SELECT NULLIF(creator_x_user_id, '') AS id FROM v),
      acc AS (
        SELECT ${OPTION_COLUMNS} FROM events
        WHERE EXISTS (SELECT 1 FROM v)
          AND events.visibility_status = 'public'
          AND (events.entry_start_time IS NOT NULL OR events.entry_end_time IS NOT NULL)
          AND (events.entry_start_time IS NULL OR events.entry_start_time <= ?3)
          AND (events.entry_end_time IS NULL OR events.entry_end_time > ?3)
          AND (events.start_time IS NULL OR events.end_time IS NULL OR events.end_time > ?3)
          AND events.allow_user_video_event_links = 1
        ORDER BY events.id
        LIMIT ${ENTRY_PAGE_ROWS} OFFSET ?4),
      att AS (
        SELECT ${OPTION_COLUMNS} FROM events
        WHERE ?4 = 0 AND events.id IN (SELECT event_id FROM ev)
        ORDER BY events.id
        LIMIT ${MAX_FORM_ATTACHED_EVENTS}),
      opt AS (SELECT id FROM acc UNION SELECT id FROM att),
      stq AS (
        SELECT id, event_id, question_key, label, sort_order, is_active FROM event_custom_questions
        WHERE event_id IN (SELECT event_id FROM ev) AND ${STAGE_PERMISSION_KEY_SQL}
        ORDER BY event_id, sort_order, id
        LIMIT ${MAX_STAGE_ANSWER_ROWS + 1})`,
    arms: [
      `SELECT 'acc' AS k, ${optionObject("acc")} AS j FROM acc`,
      `SELECT 'att' AS k, ${optionObject("att")} AS j FROM att`,
      questions.sql,
      stage.sql,
      // initialCustomAnswers: the video's answers to the active general questions of the option events
      `SELECT 'ans' AS k, json_object('event_id', q.event_id, 'question_key', q.question_key, 'answer_text', q.answer_text, 'answer_json', q.answer_json) AS j FROM (
         SELECT a.event_id AS event_id, c.question_key AS question_key, a.answer_text AS answer_text, a.answer_json AS answer_json
         FROM video_custom_answers a INNER JOIN event_custom_questions c ON c.id = a.question_id
         WHERE a.video_id = ?1 AND c.event_id IN (SELECT id FROM opt) AND c.is_active = 1 AND NOT ${STAGE_PERMISSION_KEY_SQL}
         ORDER BY a.event_id, c.sort_order, c.id
         LIMIT ${MAX_FORM_CUSTOM_ANSWERS + 1}) q`,
      `SELECT 'stq' AS k, json_object('id', q.id, 'event_id', q.event_id, 'question_key', q.question_key, 'label', q.label, 'sort_order', q.sort_order, 'is_active', q.is_active) AS j FROM stq q`,
      `SELECT 'stans' AS k, json_object('question_id', q.question_id, 'answer_text', q.answer_text) AS j FROM (
         SELECT a.question_id AS question_id, a.answer_text AS answer_text FROM video_custom_answers a
         WHERE a.video_id = ?1 AND a.event_id IN (SELECT event_id FROM stq) AND a.question_id IN (SELECT id FROM stq)
         ORDER BY a.event_id, a.question_id
         LIMIT ${MAX_STAGE_ANSWER_ROWS + 1}) q`,
      softwareArms(),
      candidateArms(),
    ],
  };
}

const cleanId = (value: string): string => value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
const cleanText = (value: string, fallback: string): string => (value.trim() ? value.trim() : fallback);
/** CURRENT DEFAULT_STAGE_PERMISSION_FIELD.label (src/lib/video/formSettings.ts). */
const DEFAULT_STAGE_LABEL = "ステージ・素材・権利まわりの使用許可";

/** CURRENT readStagePermissionCustomAnswers over the rows the statement read (null = no event / no question / no value). */
function stagePermissionInitialOf(video: VideoRow, videoEventIds: readonly string[], arms: ArmRows): string | null {
  const eventIds = pageEventIds(video, videoEventIds);
  if (eventIds.length === 0) return null;
  const questions = armOf<StageQuestion>(arms, "stq");
  if (questions.length > MAX_STAGE_ANSWER_ROWS) throw new Error("video_stage_answer_read_limit_exceeded");
  if (questions.length === 0) return null;
  const answers = armOf<{ question_id: string; answer_text: string | null }>(arms, "stans");
  if (answers.length > MAX_STAGE_ANSWER_ROWS) throw new Error("video_stage_answer_read_limit_exceeded");
  const answerByQuestionId = new Map(answers.map((answer) => [answer.question_id, answer.answer_text ?? ""] as const));
  const cleaned = questions
    .filter((question) => question.is_active === 1)
    .sort((a, b) =>
      a.event_id === b.event_id ? a.sort_order - b.sort_order : eventIds.indexOf(a.event_id) - eventIds.indexOf(b.event_id),
    )
    .map((question) => ({
      id: cleanId(question.question_key),
      label: cleanText(question.label, DEFAULT_STAGE_LABEL),
      value: answerByQuestionId.get(question.id)?.trim() ?? "",
    }))
    .filter((answer) => answer.id && answer.value);
  return cleaned.length === 0 ? null : JSON.stringify({ version: 1, answers: cleaned });
}

/** CURRENT initialCustomAnswers (keys `<event_id>:<question_key>`; an invalid answer JSON falls back to the text). */
function customAnswersOf(rows: readonly AnswerRow[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const row of rows) {
    const key = `${row.event_id}:${row.question_key}`;
    if (row.answer_json?.trim()) {
      try {
        const parsed = JSON.parse(row.answer_json) as unknown;
        if (Array.isArray(parsed)) {
          out[key] = parsed
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean);
          continue;
        }
      } catch {
        // CURRENT: an invalid answer JSON is treated as empty and the text answer is used.
      }
    }
    if (row.answer_text?.trim()) out[key] = row.answer_text.trim();
  }
  return out;
}

export const personalEditFormOptionsRoutes = new Hono<AppEnv>().get("/:id/form-options", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const id = c.req.param("id");
  const ctx = await loadPersonalContext(db, sessionUser, {});
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const user = ctx.user;
  const approvedXIds = approvedXIdsOf(ctx.linkedRows);
  const offset = parseOffset(c.req.query("offset"));
  const now = Math.floor(Date.now() / 1000);

  const { results } = await db
    .prepare(editStatementSql("form", formExtra()))
    .bind(id, approvedIdsJson(approvedXIds), now, offset)
    .all<{ k: string; j: string | null }>();
  const arms = parseDataRows(results, MAX_FORM_ROWS);
  const data = editDataOf(arms);
  const video = data.video;
  if (!video) return c.json({ error: "not_found" }, 404);

  // The same gate as GET /api/personal/edit/:id: the page renders the form only for kind "edit".
  const requested = c.req.queries("privileged");
  const decision = decideEditPage({
    userRole: user.role,
    video,
    data,
    context: buildAccessContext({ userId: user.id, video, approvedXIds, data }),
    requestedMode: normalizePrivilegeMode(requested?.length === 1 ? requested[0] : undefined),
  });
  if (!decision.hasAnyEditCapability || decision.canShowPrivilegeSwitchOnly) {
    return c.json({ kind: "no_access" } satisfies EditFormOptionsResponse);
  }

  const accepting = armOf<OptionRow>(arms, "acc");
  const acceptingIds = new Set(accepting.map((option) => option.id));
  // Attached events come first on the first page (so a byte cut never drops them); a later page may repeat one at its natural place.
  const prepended = armOf<OptionRow>(arms, "att").filter((option) => !acceptingIds.has(option.id));
  const raw = [...prepended, ...accepting];
  const stageSettings = stageSettingsJsonByEvent(nestedRows<StageQuestionRow>(arms, "stage"));
  const questionsByEvent = groupCustomQuestions(
    nestedRows<CustomQuestionRow>(arms, "cq"),
    raw.map((option) => option.id),
  );
  const allOptions: SlottedEventOption[] = raw.map((option) => ({
    id: option.id,
    title: option.title,
    parts_json: option.parts_json ?? null,
    youtube_description_template: option.youtube_description_template ?? null,
    required_video_fields_json: option.required_video_fields_json ?? null,
    video_form_settings_json: stageSettings.get(option.id) ?? null,
    custom_questions: questionsByEvent.get(option.id) ?? [],
  }));

  const answerRows = armOf<AnswerRow>(arms, "ans");
  const hasCreatorX = Boolean(video.creator_x_user_id);
  const rest = {
    kind: "ready" as const,
    customAnswers: customAnswersOf(answerRows.slice(0, MAX_FORM_CUSTOM_ANSWERS)),
    customAnswersTruncated: answerRows.length > MAX_FORM_CUSTOM_ANSWERS,
    stagePermissionAnswers: stagePermissionInitialOf(video, data.videoEventIds, arms),
    softwareSuggestions: softwareSuggestionsOf(arms),
    iconCandidates: hasCreatorX ? iconCandidatesOf(arms) : [],
    channelCandidates: hasCreatorX ? channelCandidatesOf(arms) : [],
  };
  // Options are cut by bytes so the whole response stays <= 64 KiB; nextOffset continues from the cut (counted in accepting rows).
  const fit = takeWithinBytes(
    allOptions,
    MAX_RESPONSE_BYTES - jsonBytes({ ...rest, eventOptions: [], truncated: true, nextOffset: 1000 }),
  );
  const truncated = accepting.length >= ENTRY_PAGE_ROWS || fit.cut;
  const keptAccepting = Math.max(0, fit.items.length - prepended.length);
  // Fail closed when a cut makes no progress (the attached-only events alone fill the budget): nextOffset would equal
  // offset and the SPA would refetch the same page forever.
  if (fit.cut && keptAccepting === 0) throw new Error("form_options_no_progress");
  const body: EditFormOptionsResponse = {
    ...rest,
    eventOptions: fit.items,
    truncated,
    nextOffset: truncated ? nextOffsetOf(offset + keptAccepting) : null,
  };
  assertResponseBytes(body);
  return c.json(body);
});
