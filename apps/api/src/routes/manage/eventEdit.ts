import { Hono } from "hono";
import type { ManageEventEditResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn, resolveActiveXUserId } from "../personal/context.ts";
import { canEditEvent, loadManageSnapshot, manageGate } from "./access.ts";
import type { ManageLinkedX } from "./events.ts";

// CURRENT: app/(manage)/manage/events/[id]/edit/page.tsx + src/lib/video/stagePermissionQuestions.ts
// (loadStagePermissionFormSettingsJson) + src/lib/video/customQuestionAnswers.ts (loadGeneralCustomQuestionsForEvent)
// + src/lib/video/customQuestions.ts (rowToQuestion) + src/lib/event/generalCustomQuestionDraft.ts.
// Authorization (CURRENT): the event row must exist, and the caller needs event.basic, event.publish, event.questions
// or event.slots on it (admin always) - else 404. Note CURRENT does not require the event to be in the manageable list
// beyond those permissions, which is the same condition.
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then ONE statement.
// More than 18 general custom questions fail like CURRENT (video_custom_question_read_limit_exceeded -> 503).
const MAX_VIDEO_CUSTOM_QUESTIONS_READ = 18;
const MAX_STAGE_FORM_QUESTIONS = 100;
const MAX_LINKED_X = 100;
const MAX_QUESTION_OPTIONS = 50;
const OPTION_MAX_LEN = 200;

const EVENT_COLUMNS = [
  "id",
  "updated_at",
  "title",
  "event_type",
  "explanation",
  "youtube_description_template",
  "required_video_fields_json",
  "icon_url",
  "img_url",
  "accent_color",
  "start_time",
  "end_time",
  "entry_start_time",
  "entry_end_time",
  "visibility_status",
  "allow_user_video_event_links",
  "allow_unslotted_posts",
  "allow_user_video_edits",
  "user_video_edit_permission_keys_json",
  "max_slots_per_video",
  "max_slot_reservation_groups_per_xid",
  "slot_interval_minutes",
  "slot_part_gap_minutes",
  "slot_type",
  "slot_visibility_mode",
  "parts_json",
  "editable_fields",
  "review_settings",
] as const;

/** CURRENT parseOptionsJson. */
function parseOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim().slice(0, OPTION_MAX_LEN);
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_QUESTION_OPTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

const QUESTION_TYPES = ["text", "textarea", "select", "radio", "checkbox"] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];
const parseQuestionType = (value: unknown): QuestionType =>
  typeof value === "string" && (QUESTION_TYPES as readonly string[]).includes(value) ? (value as QuestionType) : "textarea";

type EventRow = Record<(typeof EVENT_COLUMNS)[number], string | number | null>;

export const manageEventEditRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  const editableSections = {
    basic: canEditEvent(snapshot, eventId, "event.basic"),
    publish: canEditEvent(snapshot, eventId, "event.publish"),
    questions: canEditEvent(snapshot, eventId, "event.questions"),
    slots: canEditEvent(snapshot, eventId, "event.slots"),
  };
  // CURRENT reads the event first (404 when missing) and then checks permissions (404): both are 404, so the
  // permission check can run before the statement without changing any observable result.
  if (!editableSections.basic && !editableSections.publish && !editableSections.questions && !editableSections.slots) {
    return c.json({ error: "Not Found" }, 404);
  }

  const row = await db
    .prepare(
      `SELECT (SELECT json_object(${EVENT_COLUMNS.map((col) => `'${col}', e.${col}`).join(", ")}) FROM events e WHERE e.id = ?) AS event,
         (SELECT COUNT(*) FROM video_events pe INNER JOIN videos pv ON pv.id = pe.video_id
           WHERE pe.event_id = ? AND pv.visibility_status = 'pending') AS pending_count,
         (SELECT json_group_array(json_object('question_key', q.question_key, 'label', q.label, 'description', q.description,
              'placeholder', q.placeholder, 'required', q.required, 'is_active', q.is_active)) FROM (
            SELECT question_key, label, description, placeholder, required, is_active FROM event_custom_questions
            WHERE event_id = ? AND (question_key = 'stage_permission' OR substr(question_key, 1, 17) = 'stage_permission_')
            ORDER BY event_id, sort_order LIMIT ?) q) AS stage_questions,
         (SELECT json_group_array(json_object('id', q.id, 'question_key', q.question_key, 'label', q.label, 'description', q.description,
              'type', q.type, 'required', q.required, 'options_json', q.options_json, 'placeholder', q.placeholder, 'is_active', q.is_active)) FROM (
            SELECT id, question_key, label, description, type, required, options_json, placeholder, is_active FROM event_custom_questions
            WHERE event_id = ? AND NOT (question_key = 'stage_permission' OR substr(question_key, 1, 17) = 'stage_permission_')
            ORDER BY sort_order ASC, id ASC LIMIT ?) q) AS general_questions,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'approval_status', q.approval_status)) FROM (
            SELECT x_users.id AS x_user_id, x_users.approval_status AS approval_status
            FROM x_user_account_links INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
            WHERE x_user_account_links.auth_user_id = ? LIMIT ?) q) AS linked`,
    )
    .bind(
      eventId,
      eventId,
      eventId,
      MAX_STAGE_FORM_QUESTIONS,
      eventId,
      MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1,
      user.id,
      MAX_LINKED_X,
    )
    .first<{
      event: string | null;
      pending_count: number;
      stage_questions: string | null;
      general_questions: string | null;
      linked: string | null;
    }>();
  const event = parseJsonColumn<EventRow | null>(row?.event, null);
  if (!row || !event) return c.json({ error: "Not Found" }, 404);

  const general = parseJsonColumn<
    {
      id: string;
      question_key: string;
      label: string;
      description: string | null;
      type: string;
      required: number;
      options_json: string | null;
      placeholder: string | null;
      is_active: number;
    }[]
  >(row.general_questions, []);
  if (general.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) throw new Error("video_custom_question_read_limit_exceeded");
  const stage = parseJsonColumn<
    {
      question_key: string;
      label: string;
      description: string | null;
      placeholder: string | null;
      required: number;
      is_active: number;
    }[]
  >(row.stage_questions, []);

  const body: ManageEventEditResponse = {
    isAdmin: snapshot.isAdmin,
    pendingCount: Number(row.pending_count ?? 0),
    activeXUserId: resolveActiveXUserId(user.active_x_user_id, parseJsonColumn<ManageLinkedX[]>(row.linked, [])),
    manageStaffXUserIds: snapshot.manageStaffXUserIds,
    editableSections,
    initial: {
      ...(event as unknown as ManageEventEditResponse["initial"]),
      event_type: (event.event_type ?? "event") as "event" | "collabo" | "type" | "other",
      slot_type: (event.slot_type ?? "time") as "time" | "count",
      slot_visibility_mode: (event.slot_visibility_mode ?? "public_name") as "public_name" | "anonymous" | "hidden",
      video_form_settings_json:
        stage.length === 0
          ? null
          : JSON.stringify({
              stage_permissions: stage.map((q) => ({
                id: q.question_key,
                enabled: q.is_active === 1,
                required: q.required === 1,
                label: q.label,
                description: q.description ?? "",
                placeholder: q.placeholder ?? "",
              })),
            }),
      custom_questions: general.map((q) => ({
        clientId: q.id,
        question_key: q.question_key,
        label: q.label,
        description: q.description ?? "",
        type: parseQuestionType(q.type),
        required: q.required === 1,
        options: parseOptionsJson(q.options_json),
        placeholder: q.placeholder ?? "",
        enabled: q.is_active === 1,
      })),
    },
  };
  return c.json(body);
});
