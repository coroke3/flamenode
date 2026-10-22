import { Hono } from "hono";
import type { SlottedEntryResponse, SlottedEventOption } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { loadPersonalContext } from "../context.ts";
import { groupCustomQuestions, stageSettingsJsonByEvent, type CustomQuestionRow, type StageQuestionRow } from "./customQuestions.ts";
import {
  approvedXRows,
  channelCandidatesOf,
  iconCandidatesOf,
  initialProfileOf,
  slottedSubmitBlock,
  softwareSuggestionsOf,
  type ActiveXRow,
} from "./formData.ts";
import { armOf, armOne, loadArmRows } from "./rows.ts";
import { resolvePartFromSlotRows, type PartSlot } from "./slotPart.ts";
import {
  activeXArm,
  candidateArms,
  customQuestionArm,
  MAX_PART_SLOTS,
  MAX_SLOTTED_EVENT_OPTIONS,
  MAX_STAGE_QUESTION_ROWS,
  softwareArms,
  stageQuestionArm,
} from "./sql.ts";

// CURRENT: app/(auth)/entry/slotted/page.tsx. GET only. CURRENT's redirect() calls are returned as
// `{ kind: "redirect", to }` (200) and notFound() as 404 `{ error: "not_found" }`.
// D1 (S2, 3 statements incl. the session lookup): context = 1, then ONE data statement (slot + event + group span +
// active X + software + candidates + accepting event options + their questions + the event's slots for the part).

interface SlotRow {
  id: string;
  event_id: string;
  status: string | null;
  video_id: string | null;
  x_user_id: string | null;
  start_time: number | null;
  slot_label: string | null;
  display_name: string | null;
  reservation_group_id: string | null;
  reserved_x_id_snapshot: string | null;
}

interface EventOptionRow {
  id: string;
  title: string;
  parts_json: string | null;
  youtube_description_template: string | null;
  required_video_fields_json: string | null;
  slot_part_gap_minutes?: number | null;
}

const optionObject = (alias: string) =>
  `json_object('id', ${alias}.id, 'title', ${alias}.title, 'parts_json', ${alias}.parts_json,
     'youtube_description_template', ${alias}.youtube_description_template,
     'required_video_fields_json', ${alias}.required_video_fields_json`;

export const personalEntrySlottedRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const slotId = c.req.query("slot") ?? "";
  const ctx = await loadPersonalContext(db, sessionUser, {});
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const user = ctx.user;
  if (!slotId) return c.json({ kind: "redirect", to: "/entry" } satisfies SlottedEntryResponse);

  const activeXId = user.active_x_user_id;
  const now = Math.floor(Date.now() / 1000);
  // x_user_id is the reservation's identity snapshot, not its owner (CURRENT comment): the owner continues the flow;
  // another Discord account may open an unsubmitted slot only when its active X ID matches the snapshot.
  const owner = activeXId
    ? {
        sql: `((slots.reserved_by_user_id = ? AND (slots.x_user_id = ? OR slots.x_user_id IS NULL))
          OR (slots.status = 'reserved' AND slots.x_user_id = ?))`,
        params: [user.id, activeXId, activeXId],
      }
    : { sql: "slots.reserved_by_user_id = ?", params: [user.id] };

  const stage = stageQuestionArm("opt_ids");
  const questions = customQuestionArm("opt_ids", MAX_SLOTTED_EVENT_OPTIONS + 1);
  const arms = await loadArmRows(
    db
      .prepare(
        `WITH slot AS (
           SELECT slots.id AS id, slots.event_id AS event_id, slots.status AS status, slots.video_id AS video_id,
             slots.x_user_id AS x_user_id, slots.start_time AS start_time, slots.slot_label AS slot_label,
             slots.display_name AS display_name, slots.reservation_group_id AS reservation_group_id,
             slots.reserved_x_id_snapshot AS reserved_x_id_snapshot
           FROM slots WHERE slots.id = ? AND ${owner.sql} LIMIT 1
         ),
         go AS (SELECT 1 AS v FROM slot WHERE status = 'reserved'),
         ev AS (
           SELECT events.id AS id, events.title AS title, events.slot_part_gap_minutes AS slot_part_gap_minutes,
             events.parts_json AS parts_json, events.youtube_description_template AS youtube_description_template,
             events.required_video_fields_json AS required_video_fields_json
           FROM events WHERE events.id = (SELECT event_id FROM slot) LIMIT 1
         ),
         ax AS (SELECT NULLIF(COALESCE((SELECT x_user_id FROM slot), ?), '') AS id),
         acc AS (
           SELECT events.id AS id, events.title AS title, events.parts_json AS parts_json,
             events.youtube_description_template AS youtube_description_template,
             events.required_video_fields_json AS required_video_fields_json
           FROM events
           WHERE EXISTS (SELECT 1 FROM go)
             AND events.visibility_status = 'public'
             AND (events.entry_start_time IS NOT NULL OR events.entry_end_time IS NOT NULL)
             AND (events.entry_start_time IS NULL OR events.entry_start_time <= ?)
             AND (events.entry_end_time IS NULL OR events.entry_end_time > ?)
             AND (events.start_time IS NULL OR events.end_time IS NULL OR events.end_time > ?)
             AND events.allow_user_video_event_links = 1
           ORDER BY events.id
           LIMIT ${MAX_SLOTTED_EVENT_OPTIONS + 1}
         ),
         opt_ids AS (SELECT id FROM acc UNION SELECT id FROM ev)
         SELECT 'slot' AS k, json_object('id', slot.id, 'event_id', slot.event_id, 'status', slot.status,
             'video_id', slot.video_id, 'x_user_id', slot.x_user_id, 'start_time', slot.start_time,
             'slot_label', slot.slot_label, 'display_name', slot.display_name,
             'reservation_group_id', slot.reservation_group_id,
             'reserved_x_id_snapshot', slot.reserved_x_id_snapshot) AS j
           FROM slot
         UNION ALL
         SELECT 'ev' AS k, ${optionObject("ev")}, 'slot_part_gap_minutes', ev.slot_part_gap_minutes) AS j FROM ev
         UNION ALL
         SELECT 'group' AS k, json_object('n', COUNT(*), 'min', MIN(slots.start_time), 'max', MAX(slots.start_time)) AS j
           FROM slots
           WHERE EXISTS (SELECT 1 FROM go)
             AND slots.event_id = (SELECT event_id FROM slot)
             AND slots.reservation_group_id = (SELECT reservation_group_id FROM slot)
             AND (SELECT reservation_group_id FROM slot) <> ''
         UNION ALL
         ${activeXArm()}
         UNION ALL
         SELECT 'acc' AS k, ${optionObject("acc")}) AS j FROM acc
         UNION ALL
         ${stage.sql}
         UNION ALL
         ${questions.sql}
         UNION ALL
         SELECT 'pslot' AS k, json_object('id', q.id, 'start_time', q.start_time, 'sort_order', q.sort_order) AS j FROM (
           SELECT slots.id AS id, slots.start_time AS start_time, slots.sort_order AS sort_order FROM slots
           WHERE EXISTS (SELECT 1 FROM go) AND slots.event_id = (SELECT event_id FROM slot)
             AND (SELECT COALESCE(trim(parts_json), '') FROM ev) <> ''
           LIMIT ${MAX_PART_SLOTS + 1}) q
         UNION ALL
         ${softwareArms("EXISTS (SELECT 1 FROM go)")}
         UNION ALL
         ${candidateArms()}`,
      )
      .bind(slotId, ...owner.params, activeXId, now, now, now),
  );

  const slot = armOne<SlotRow>(arms, "slot");
  if (!slot) return c.json({ error: "not_found" }, 404);
  if (slot.status === "submitted" && slot.video_id) {
    return c.json({ kind: "redirect", to: `/dashboard/edit/${slot.video_id}` } satisfies SlottedEntryResponse);
  }
  if (slot.status !== "reserved") return c.json({ kind: "redirect", to: "/entry" } satisfies SlottedEntryResponse);
  if (slot.x_user_id && activeXId && slot.x_user_id !== activeXId) {
    return c.json({ kind: "redirect", to: "/entry" } satisfies SlottedEntryResponse);
  }
  const ev = armOne<EventOptionRow>(arms, "ev");
  if (!ev) return c.json({ error: "not_found" }, 404);

  // group span (連続枠): CURRENT reads every slot of the group and takes min/max of the numeric start times.
  let slotStart = slot.start_time ?? null;
  let slotEnd = slot.start_time ?? null;
  let groupSize = 1;
  const group = slot.reservation_group_id ? armOne<{ n: number; min: number | null; max: number | null }>(arms, "group") : null;
  if (group && group.n > 0) {
    groupSize = group.n;
    if (group.min != null && group.max != null) {
      slotStart = group.min;
      const configuredGapMinutes = ev.slot_part_gap_minutes ?? 15;
      const slotGapSeconds =
        Number.isFinite(configuredGapMinutes) && configuredGapMinutes >= 0 ? configuredGapMinutes * 60 : 15 * 60;
      slotEnd = group.max + slotGapSeconds;
    }
  }

  const activeX = slot.x_user_id ?? activeXId;
  const xRow = armOne<ActiveXRow>(arms, "x");
  const xIdOptions = approvedXRows(ctx.linkedRows).sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));

  const accepting = armOf<EventOptionRow>(arms, "acc");
  if (accepting.length > MAX_SLOTTED_EVENT_OPTIONS) throw new Error("entry_event_options_exceeded");
  const slotEventOption: EventOptionRow = {
    id: ev.id,
    title: ev.title,
    parts_json: ev.parts_json,
    youtube_description_template: ev.youtube_description_template,
    required_video_fields_json: ev.required_video_fields_json,
  };
  const rawEventOptions = accepting.some((option) => option.id === ev.id) ? accepting : [slotEventOption, ...accepting];
  const stageRows = armOf<StageQuestionRow>(arms, "stage");
  if (stageRows.length > MAX_STAGE_QUESTION_ROWS) throw new Error("entry_stage_rows_exceeded");
  const stageSettings = stageSettingsJsonByEvent(stageRows);
  const questionsByEvent = groupCustomQuestions(
    armOf<CustomQuestionRow>(arms, "cq"),
    rawEventOptions.map((option) => option.id),
  );
  const eventOptions: SlottedEventOption[] = rawEventOptions.map((option) => ({
    id: option.id,
    title: option.title,
    parts_json: option.parts_json ?? null,
    youtube_description_template: option.youtube_description_template ?? null,
    required_video_fields_json: option.required_video_fields_json ?? null,
    video_form_settings_json: stageSettings.get(option.id) ?? null,
    custom_questions: questionsByEvent.get(option.id) ?? [],
  }));

  const partSlots = armOf<PartSlot>(arms, "pslot");
  if (partSlots.length > MAX_PART_SLOTS) throw new Error("entry_part_slots_exceeded");
  const slotPart = resolvePartFromSlotRows({
    slotId: slot.id,
    partsJson: ev.parts_json ?? null,
    slotPartGapMinutes: ev.slot_part_gap_minutes ?? null,
    eventSlots: partSlots,
  });

  const body: SlottedEntryResponse = {
    kind: "ready",
    user,
    activeXId: activeX ?? null,
    submitBlock: slottedSubmitBlock(activeXId, xRow),
    initialProfile: initialProfileOf(slot.display_name ?? xRow?.x_name ?? user.name, xRow, user),
    xIdOptions,
    softwareSuggestions: softwareSuggestionsOf(arms),
    iconCandidates: activeX ? iconCandidatesOf(arms) : [],
    channelCandidates: activeX ? channelCandidatesOf(arms) : [],
    slot: {
      id: slot.id,
      slot_label: slot.slot_label ?? null,
      display_name: slot.display_name ?? null,
      has_reservation_group: Boolean(slot.reservation_group_id),
      reserved_at_x_id: slot.reserved_x_id_snapshot ?? slot.x_user_id ?? null,
      start_time: slotStart,
      end_time: slotEnd,
      group_size: groupSize,
    },
    event: { id: ev.id, title: ev.title },
    activeXName: xRow?.x_name ?? null,
    slotPart,
    eventOptions,
  };
  return c.json(body);
});
