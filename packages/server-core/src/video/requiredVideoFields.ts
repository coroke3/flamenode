import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { eventCustomQuestions, events, slots, videos } from "@flamenode/db/schema";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { assertCondition } from "../audit/mutate.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";
import {
  unionRequiredVideoFields,
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
