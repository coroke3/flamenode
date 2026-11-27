import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { eventCustomQuestions, events, slots, videos } from "@flamenode/db/schema";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { assertCondition } from "../audit/mutate.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";
import {
  unionRequiredVideoFields,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  type RequiredVideoFieldValues,
  UnslottedEventSyncError,
  type OptionalRequiredVideoField,
} from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { unslottedEventEligibilityWhere } from "./unslottedEventEligibility.ts";
import { MAX_VIDEO_CUSTOM_QUESTIONS_READ } from "./freeVideoCustomQuestionRead.ts";

/** MIG-0651 unmounted SA-086 general-question read candidate. */
export { loadGeneralCustomQuestionsForFreeVideo, decodeGeneralCustomQuestionPolicyProjection, type LoadedGeneralCustomQuestion } from "./freeVideoCustomQuestionRead.ts";

/** SA-086/088/089: reads the union of required fields across linked events. */
export async function loadUnionRequiredVideoFields(
  db: ServerCoreDb,
  eventIds: readonly string[],
): Promise<OptionalRequiredVideoField[]> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ required_video_fields_json: events.required_video_fields_json })
    .from(events)
    .where(inArray(events.id, ids));
  return unionRequiredVideoFields(
    rows.map((row) => row.required_video_fields_json),
  );
}

/**
 * MIG-0651 SA-086 only: one event D1 SELECT supplies both eligibility and
 * required fields from the same row. Keeps the preflight error precedence
 * (ineligible event before missing fields and YouTube duplication), without
 * adding the older second events SELECT. The eventual atomic write must
 * still revalidate event eligibility and required-field policy.
 */
export async function loadEligibleUnslottedVideoRequiredFields(
  db: ServerCoreDb,
  eventId: string | null,
  nowSec: number,
  youtubeId: string,
  includeQuestionPolicy = false,
  includeEventTitle = false,
): Promise<{
  eventId: string | null;
  requiredFields: OptionalRequiredVideoField[];
  requiredFieldsSnapshot: string | null;
  youtubeDuplicate: boolean | null;
  questionPolicyJson?: string;
  eventTitle?: string | null;
}> {
  if (!eventId) return {
    eventId: null, requiredFields: [], requiredFieldsSnapshot: null, youtubeDuplicate: null,
    ...(includeQuestionPolicy ? { questionPolicyJson: "[]" } : {}),
    ...(includeEventTitle ? { eventTitle: null } : {}),
  };
  const row = (
    await db.select({
      id: events.id,
      ...(includeEventTitle ? { title: events.title } : {}),
      required_video_fields_json: events.required_video_fields_json,
      // Use the exact CURRENT duplicate predicate as a correlated scalar
      // projection. One bounded D1 SELECT now checks the eligible event,
      // required-field snapshot AND non-voided YouTube duplication together.
      youtube_duplicate: sql<number>`EXISTS (
        SELECT 1 FROM ${videos}
        WHERE ${videos.youtube_video_id} = ${youtubeId}
          AND ${videos.visibility_status} <> ${"voided"}
      )`,
      // Full SA-086 only: include ordered general question policy in the
      // SAME event-row D1 SELECT; older standalone callers do not pay for it.
      question_policy_json: includeQuestionPolicy ? sql<string>`(
        SELECT json_group_array(json_array(
          id, event_id, question_key, label, type, required, options_json,
          max_length, sort_order, visibility, updated_at
        )) FROM (
          SELECT ${eventCustomQuestions.id} AS id,
                 ${eventCustomQuestions.event_id} AS event_id,
                 ${eventCustomQuestions.question_key} AS question_key,
                 ${eventCustomQuestions.label} AS label,
                 ${eventCustomQuestions.type} AS type,
                 ${eventCustomQuestions.required} AS required,
                 ${eventCustomQuestions.options_json} AS options_json,
                 ${eventCustomQuestions.max_length} AS max_length,
                 ${eventCustomQuestions.sort_order} AS sort_order,
                 ${eventCustomQuestions.visibility} AS visibility,
                 ${eventCustomQuestions.updated_at} AS updated_at
          FROM ${eventCustomQuestions}
          WHERE ${eventCustomQuestions.event_id} = ${eventId}
            AND ${eventCustomQuestions.is_active} = 1
            AND ${eventCustomQuestions.question_key} <> ${"stage_permission"}
            AND substr(${eventCustomQuestions.question_key}, 1, ${"stage_permission_".length}) <> ${"stage_permission_"}
          ORDER BY ${eventCustomQuestions.sort_order} ASC, ${eventCustomQuestions.id} ASC
          LIMIT ${MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1}
        )
      )` : sql<string | null>`NULL`,
    }).from(events).where(
      and(eq(events.id, eventId), unslottedEventEligibilityWhere(nowSec))!,
    ).limit(1)
  )[0];
  if (!row) throw new UnslottedEventSyncError("unslotted_event_not_allowed");
  // Requested policy snapshots must be present and typed; do not silently
  // treat an unavailable projection as an empty question policy.
  if (includeQuestionPolicy && typeof row.question_policy_json !== "string") {
    throw new Error("video_custom_question_projection_unavailable");
  }
  return {
    eventId: row.id,
    requiredFields: unionRequiredVideoFields([row.required_video_fields_json]),
    requiredFieldsSnapshot: row.required_video_fields_json,
    youtubeDuplicate: row.youtube_duplicate === 1,
    ...(includeQuestionPolicy ? { questionPolicyJson: row.question_policy_json as string } : {}),
    ...(includeEventTitle ? { eventTitle: typeof row.title === "string" ? row.title : null } : {}),
  };
}

export type SlotSubmissionReceiptRow = typeof slots.$inferSelect;
export type SlotSubmissionReceipt = {
  anchor: SlotSubmissionReceiptRow;
  group: { kind: "ready"; rows: SlotSubmissionReceiptRow[] } | { kind: "overflow" };
};

const SLOT_RECEIPT_COLUMNS = `id, event_id, reserved_by_user_id, x_user_id, reserved_x_id_snapshot,
  display_name, slot_label, start_time, sort_order, reservation_group_id, video_id, status, updated_at, version`;

/** SA-088 U03a candidate: one statement provides the initial anchor and the
 * reservation group from the same database snapshot (#896 A). Do not mount
 * until the remaining preflight and same-batch CAS are integrated. No policy
 * decision is made here: the caller must check the anchor's authorization
 * before form errors and report overflow at CURRENT's group-validation stage.
 * The group is unordered; apply CURRENT's chronological comparator there.
 * A row-count limit does not bound the bytes of legacy text columns.
 */
export async function readSlotSubmissionReceipt(
  db: Pick<ServerCoreDb, "all">,
  slotId: string,
): Promise<SlotSubmissionReceipt | null> {
  const results = await db.all<SlotSubmissionReceiptRow & { receipt_kind: number }>(sql`WITH anchor AS (
    SELECT ${sql.raw(SLOT_RECEIPT_COLUMNS)} FROM slots WHERE id = ${slotId} LIMIT 1
  ), group_rows AS (
    SELECT ${sql.raw(SLOT_RECEIPT_COLUMNS)} FROM slots
    WHERE reservation_group_id = (SELECT NULLIF(reservation_group_id, '') FROM anchor)
      AND event_id = (SELECT event_id FROM anchor)
    LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
  )
  SELECT 0 AS receipt_kind, anchor.* FROM anchor
  UNION ALL
  SELECT 1 AS receipt_kind, group_rows.* FROM group_rows`);
  const anchors = results.filter((row) => row.receipt_kind === 0);
  if (anchors.length === 0) return null;
  const { receipt_kind: _kind, ...anchor } = anchors[0];
  if (!anchor.reservation_group_id) return { anchor, group: { kind: "ready", rows: [anchor] } };
  const groupRows = results.filter((row) => row.receipt_kind === 1);
  if (groupRows.length > MAX_SLOTS_PER_VIDEO) return { anchor, group: { kind: "overflow" } };
  return { anchor, group: { kind: "ready", rows: groupRows.map(({ receipt_kind: _kind, ...row }) => row) } };
}

/**
 * SA-088 U03a: recheck the complete reservation receipt inside the SAME D1
 * batch, before any resource/slot/audit DML. Use the existing scalar CAS and
 * assertion helpers; no JSON encoding of arbitrary legacy column values.
 * Six rows x 14 columns + count + four membership binds <= 89 binds/statement.
 * At most four statements. The caller must account for all of them in the
 * real S3 budget and preserve authorization/group validation before this step.
 * This is not a new route or a complete mutation plan.
 */
export function buildSlotSubmissionReceiptAssertions(receipt: SlotSubmissionReceipt): SQL[] {
  if (receipt.group.kind !== "ready") throw new Error("slot_submission_receipt_invalid");
  const { anchor } = receipt;
  const { rows } = receipt.group;
  const columns = SLOT_RECEIPT_COLUMNS.split(",").map((column) => column.trim()) as (keyof SlotSubmissionReceiptRow)[];
  const isScalarRow = (row: SlotSubmissionReceiptRow) => Object.keys(row).length === columns.length && columns.every((column) => {
    const value = row[column];
    return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
  });
  if (!isScalarRow(anchor) || rows.length < 1 || rows.length > MAX_SLOTS_PER_VIDEO ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some((row) => !isScalarRow(row) || row.event_id !== anchor.event_id || row.reservation_group_id !== anchor.reservation_group_id) ||
      (!anchor.reservation_group_id && rows.length !== 1) ||
      !rows.some((row) => row.id === anchor.id && columns.every((column) => row[column] === anchor[column]))) {
    throw new Error("slot_submission_receipt_invalid");
  }
  const membership = anchor.reservation_group_id ? sql`
    (SELECT COUNT(*) FROM (SELECT id FROM slots
      WHERE event_id = ${anchor.event_id} AND reservation_group_id = ${anchor.reservation_group_id}
      LIMIT ${MAX_SLOTS_PER_VIDEO + 1})) = ${rows.length}
  ` : sql`1 = 1`;
  const assertions: SQL[] = [];
  for (let i = 0; i < rows.length; i += 6) {
    const chunk = rows.slice(i, i + 6);
    const matches = sql.join(chunk.map((row) => sql`(${expectedRowCondition({ expectedCurrent: row })})`), sql` OR `);
    assertions.push(assertCondition(sql`
      (SELECT COUNT(*) FROM slots WHERE ${matches}) = ${chunk.length}
      AND (${i === 0 ? membership : sql`1 = 1`})
    `));
  }
  return assertions;
}

export type SlotSubmissionExistingVideo = typeof videos.$inferSelect;
export type SlotSubmissionEventConfig = Pick<typeof events.$inferSelect,
  "id" | "title" | "parts_json" | "slot_part_gap_minutes" | "required_video_fields_json">;

export type SlotSubmissionVideoEventReceipt = {
  existing: { kind: "none" } | { kind: "missing" } |
    { kind: "found"; row: SlotSubmissionExistingVideo };
  event: SlotSubmissionEventConfig | null;
  youtubeDuplicate: boolean;
};

type SlotSubmissionVideoEventProjection = {
  [K in keyof SlotSubmissionExistingVideo]: SlotSubmissionExistingVideo[K] | null;
} & {
  receipt_event_id: string | null;
  receipt_event_title: string | null;
  receipt_parts_json: string | null;
  receipt_gap_minutes: number | null;
  receipt_required_json: string | null;
  receipt_youtube_duplicate: number;
};

/** SA-088 read projection candidate. Use the authorized receipt's anchor and
 * the parsed optional YouTube ID, never trust a client-supplied video/event ID.
 * Preserve CURRENT's separate denial stages: existing video missing before
 * part resolution, duplicate after part resolution, event existence after
 * stage/general/required validation. No visibility, deadline or configured
 * slot-count filter. The caller must not surface the later fields early.
 *
 * One result row, three binds, canonical video columns only. This is a
 * building block for the future combined preflight, NOT an extra allowed
 * read in the final S3 path; raw legacy scalar bytes and CAS remain open.
 */
export async function readSlotSubmissionVideoEventReceipt(
  db: Pick<ServerCoreDb, "all">,
  anchor: Pick<SlotSubmissionReceiptRow, "event_id" | "video_id">,
  submittedYoutubeId: string | null,
): Promise<SlotSubmissionVideoEventReceipt> {
  // Explicit schema-derived projection, not SELECT v.* (legacy columns may
  // remain in a migrated database). Only static identifiers enter this SQL.
  const videoColumns = sql.join(
    Object.values(getTableColumns(videos)).map((column) => sql`v.${sql.identifier(column.name)}`),
    sql`, `,
  );
  const rows = await db.all<SlotSubmissionVideoEventProjection>(sql`WITH submission_input AS (
    SELECT ${anchor.event_id} AS event_id, ${anchor.video_id || null} AS video_id, ${submittedYoutubeId || null} AS youtube_id
  )
  SELECT ${videoColumns},
    e.id AS receipt_event_id, e.title AS receipt_event_title,
    e.parts_json AS receipt_parts_json, e.slot_part_gap_minutes AS receipt_gap_minutes,
    e.required_video_fields_json AS receipt_required_json,
    CASE WHEN input.youtube_id IS NULL THEN 0 ELSE EXISTS (
      SELECT 1 FROM videos candidate WHERE candidate.youtube_video_id = input.youtube_id
        AND candidate.visibility_status <> 'voided'
        AND (v.id IS NULL OR candidate.id <> v.id)
      LIMIT 1
    ) END AS receipt_youtube_duplicate
  FROM submission_input input
  LEFT JOIN videos v ON v.id = input.video_id
  LEFT JOIN events e ON e.id = input.event_id
  LIMIT 1`);
  if (rows.length !== 1) throw new Error("slot_submission_video_event_receipt_invalid");
  const {
    receipt_event_id, receipt_event_title, receipt_parts_json,
    receipt_gap_minutes, receipt_required_json, receipt_youtube_duplicate,
    ...video
  } = rows[0];
  if ((receipt_youtube_duplicate !== 0 && receipt_youtube_duplicate !== 1) ||
      (video.id !== null && video.id !== (anchor.video_id || null)) ||
      (receipt_event_id !== null && (receipt_event_id !== anchor.event_id || typeof receipt_event_title !== "string"))) {
    throw new Error("slot_submission_video_event_receipt_invalid");
  }
  return {
    existing: anchor.video_id
      ? video.id === null ? { kind: "missing" } : { kind: "found", row: video as SlotSubmissionExistingVideo }
      : { kind: "none" },
    event: receipt_event_id === null ? null : {
      id: receipt_event_id,
      title: receipt_event_title!,
      parts_json: receipt_parts_json,
      slot_part_gap_minutes: receipt_gap_minutes,
      required_video_fields_json: receipt_required_json,
    },
    youtubeDuplicate: receipt_youtube_duplicate === 1,
  };
}

/** SA-088 required-field validation on the COMPLETE resolved event policy
 * union. Called only after stage and general answers. The canonical part
 * (not the form's part), first raw icon_mode entry and persisted icon match
 * CURRENT. No implicit fallback to an old YouTube URL/profile/other fields.
 * Do not call with just the anchor event when other events remain linked.
 */
export function validateSlotSubmissionRequiredFields(
  requiredPolicyJson: readonly (string | null | undefined)[],
  values: Omit<RequiredVideoFieldValues, "existing_icon_url">,
  formData: FormData,
  slotPart: string | null,
  existingIconUrl: string | null,
): { ok: true } | { ok: false; message: string } {
  const missing = firstMissingRequiredVideoField(unionRequiredVideoFields(requiredPolicyJson), {
    ...values,
    part: slotPart,
    icon_mode: String(formData.get("icon_mode") ?? values.icon_mode ?? ""),
    existing_icon_url: existingIconUrl,
  });
  return missing ? { ok: false, message: missingRequiredVideoFieldMessage(missing) } : { ok: true };
}
