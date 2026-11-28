import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import { eventCustomQuestions, eventStaff, events, slots, videos } from "@flamenode/db/schema";
import { MAX_ATOMIC_VIDEO_EVENTS } from "@flamenode/domain/video/atomicLimits";
import { resolveStaffPermissionKeys } from "@flamenode/domain/auth/permissions/resolver";
import { approvedXIdsWhere } from "../auth/approvedXPredicate.ts";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { assertCondition } from "../audit/mutate.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";
import {
  unionRequiredVideoFields,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  parseEventPartsJson,
  type RequiredVideoFieldValues,
  UnslottedEventSyncError,
  type OptionalRequiredVideoField,
} from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { unslottedEventEligibilityWhere } from "./unslottedEventEligibility.ts";
import {
  decodeGeneralCustomQuestionPolicyForEvents,
  GENERAL_QUESTION_EVENT_CHUNK_SIZE,
  MAX_VIDEO_CUSTOM_QUESTIONS_READ,
  stagePermissionQuestionKeyCondition,
  type LoadedGeneralCustomQuestion,
} from "./freeVideoCustomQuestionRead.ts";
import { buildSlotParts } from "./slotGrouping.ts";

// Keep chunk buckets integer and unbound; D1/SQLite adapters may bind JS numbers as REAL.
const GENERAL_QUESTION_EVENT_CHUNK_SIZE_SQL = sql.raw(String(GENERAL_QUESTION_EVENT_CHUNK_SIZE));

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
export type SlotPartProjectionRow = Pick<SlotSubmissionReceiptRow, "id" | "start_time" | "sort_order">;
export type SlotSubmissionPartResolution = {
  kind: "bounded" | "fallback";
  rows: SlotPartProjectionRow[];
};
export type SlotSubmissionReceipt = {
  anchor: SlotSubmissionReceiptRow;
  group: { kind: "ready"; rows: SlotSubmissionReceiptRow[] } | { kind: "overflow" };
  /** Preflight snapshot only; callers must revalidate these rows/config in the same mutation batch before writing. */
  partResolution: SlotSubmissionPartResolution;
  /** SQLite-generated exact row-set snapshot; compared again before the write batch. */
  partSnapshotJson: string;
};

export const MAX_SLOT_PART_PROJECTION_ROWS = 512;

const SLOT_RECEIPT_COLUMNS = "id, event_id, reserved_by_user_id, x_user_id, reserved_x_id_snapshot, display_name, slot_label, start_time, sort_order, reservation_group_id, video_id, status, updated_at, version";
const SLOT_RECEIPT_NULL_COLUMNS = SLOT_RECEIPT_COLUMNS.split(",")
  .map((column) => "NULL AS " + column.trim())
  .join(", ");

type SlotSubmissionReceiptQueryRow = Partial<SlotSubmissionReceiptRow> & {
  receipt_kind: number;
  part_fallback_required: number;
  part_snapshot_json: string | null;
  part_slot_id: string | null;
  part_start_time: number | null;
  part_sort_order: number | null;
};

function slotReceiptRowFromQuery(row: SlotSubmissionReceiptQueryRow): SlotSubmissionReceiptRow {
  const {
    receipt_kind: _receiptKind,
    part_fallback_required: _partFallbackRequired,
    part_slot_id: _partSlotId,
    part_start_time: _partStartTime,
    part_sort_order: _partSortOrder,
    part_snapshot_json: _partSnapshotJson,
    ...slot
  } = row;
  return slot as SlotSubmissionReceiptRow;
}

/** SA-088 U03a candidate: one statement provides the initial anchor, reservation
 * group, and part-resolution rows from the same database snapshot (#896 A).
 * Timed anchors use only the finite numeric prefix through the anchor, capped
 * at 512 rows (+1 overflow sentinel). Untimed anchors, unsafe numeric values
 * in the prefix, and over-limit/tie-crossing prefixes explicitly fall back to
 * all event slots. The fallback preserves CURRENT semantics; it is not a new
 * product limit. No policy decision is made here and /slot remains unmounted.
 *
 * The bounded projection is a transfer bound, not a Workerd CPU acceptance
 * claim. Part rows are not yet covered by the reservation-group CAS below.
 */
export async function readSlotSubmissionReceipt(
  db: Pick<ServerCoreDb, "all">,
  slotId: string,
): Promise<SlotSubmissionReceipt | null> {
  const results = await db.all<SlotSubmissionReceiptQueryRow>(sql`WITH anchor AS (
    SELECT ${sql.raw(SLOT_RECEIPT_COLUMNS)} FROM slots WHERE id = ${slotId} LIMIT 1
  ), anchor_meta AS (
    SELECT CASE
      WHEN typeof(start_time) IN ('integer', 'real')
        AND abs(CAST(start_time AS REAL)) <= 9007199254740991
      THEN 0 ELSE 1
    END AS fallback_required
    FROM anchor
  ), unsupported_prefix AS (
    SELECT CASE
      WHEN (SELECT fallback_required FROM anchor_meta) = 1 THEN 0
      WHEN EXISTS (
        SELECT 1 FROM slots
        WHERE event_id = (SELECT event_id FROM anchor)
          AND typeof(start_time) IN ('integer', 'real')
          AND start_time < -9007199254740991
        LIMIT 1
      ) THEN 1 ELSE 0
    END AS unsupported
  ), part_projection AS (
    SELECT id, start_time, sort_order FROM slots
    WHERE event_id = (SELECT event_id FROM anchor)
      AND (SELECT fallback_required FROM anchor_meta) = 0
      AND (SELECT unsupported FROM unsupported_prefix) = 0
      AND typeof(start_time) IN ('integer', 'real')
      AND start_time <= (SELECT start_time FROM anchor)
    ORDER BY start_time ASC
    LIMIT 513
  ), part_projection_meta AS (
    SELECT COUNT(*) AS row_count FROM part_projection
  ), part_meta AS (
    SELECT CASE
      WHEN (SELECT fallback_required FROM anchor_meta) = 1
        OR (SELECT unsupported FROM unsupported_prefix) = 1
        OR (SELECT row_count FROM part_projection_meta) > 512
      THEN 1 ELSE 0
    END AS fallback_required
  ), part_rows AS (
    SELECT id, start_time, sort_order FROM part_projection
    WHERE (SELECT fallback_required FROM part_meta) = 0
    UNION ALL
    SELECT id, start_time, sort_order FROM slots
    WHERE event_id = (SELECT event_id FROM anchor)
      AND (SELECT fallback_required FROM part_meta) = 1
  ), part_snapshot AS (
    SELECT json_group_array(json_array(id, start_time, sort_order)) AS snapshot_json
    FROM (
      SELECT id, start_time, sort_order FROM part_rows
      ORDER BY id COLLATE BINARY ASC
    )
  ), group_rows AS (
    SELECT ${sql.raw(SLOT_RECEIPT_COLUMNS)} FROM slots
    WHERE reservation_group_id = (SELECT NULLIF(reservation_group_id, '') FROM anchor)
      AND event_id = (SELECT event_id FROM anchor)
    LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
  )
  SELECT 0 AS receipt_kind, anchor.*,
    part_meta.fallback_required AS part_fallback_required,
    part_snapshot.snapshot_json AS part_snapshot_json,
    NULL AS part_slot_id, NULL AS part_start_time, NULL AS part_sort_order
  FROM anchor CROSS JOIN part_meta CROSS JOIN part_snapshot
  UNION ALL
  SELECT 1 AS receipt_kind, group_rows.*,
    part_meta.fallback_required AS part_fallback_required,
    NULL AS part_snapshot_json,
    NULL AS part_slot_id, NULL AS part_start_time, NULL AS part_sort_order
  FROM group_rows CROSS JOIN part_meta
  UNION ALL
  SELECT 2 AS receipt_kind, ${sql.raw(SLOT_RECEIPT_NULL_COLUMNS)},
    part_meta.fallback_required AS part_fallback_required,
    NULL AS part_snapshot_json,
    part_rows.id AS part_slot_id,
    part_rows.start_time AS part_start_time,
    part_rows.sort_order AS part_sort_order
  FROM part_rows CROSS JOIN part_meta`);
  const anchors = results.filter((row) => row.receipt_kind === 0);
  if (anchors.length === 0) return null;
  const anchorQueryRow = anchors[0];
  const anchor = slotReceiptRowFromQuery(anchorQueryRow);
  const fallbackRequired = anchorQueryRow.part_fallback_required === 1;
  const partSnapshotJson = anchorQueryRow.part_snapshot_json;
  if (typeof partSnapshotJson !== "string" || !partSnapshotJson.startsWith("[")) {
    throw new Error("slot_submission_part_snapshot_invalid");
  }
  const partRows = results.flatMap((row) =>
    row.receipt_kind === 2 && typeof row.part_slot_id === "string"
      ? [{
        id: row.part_slot_id,
        start_time: row.part_start_time,
        sort_order: row.part_sort_order,
      }]
      : [],
  );
  const partResolution: SlotSubmissionPartResolution = {
    kind: fallbackRequired ? "fallback" : "bounded",
    rows: partRows,
  };
  if (!anchor.reservation_group_id) {
    return { anchor, group: { kind: "ready", rows: [anchor] }, partResolution, partSnapshotJson };
  }
  const groupRows = results.filter((row) => row.receipt_kind === 1);
  if (groupRows.length > MAX_SLOTS_PER_VIDEO) {
    return { anchor, group: { kind: "overflow" }, partResolution, partSnapshotJson };
  }
  return {
    anchor,
    group: { kind: "ready", rows: groupRows.map(slotReceiptRowFromQuery) },
    partResolution,
    partSnapshotJson,
  };
}

/** Port of CURRENT resolvePartFromSlot using the fused slot receipt. The
 * caller supplies the event config already obtained by the slot submission
 * preflight; no additional D1 read is performed here.
 */
export function resolveSlotPartFromReceipt(
  receipt: SlotSubmissionReceipt,
  event: Pick<SlotSubmissionEventConfig, "parts_json" | "slot_part_gap_minutes"> | null,
): string | null {
  const configuredParts = parseEventPartsJson(event?.parts_json);
  if (configuredParts.length === 0) return null;
  const gapSec = (event?.slot_part_gap_minutes ?? 15) * 60;
  const slotPart = buildSlotParts(receipt.partResolution.rows, gapSec)
    .find((part) => part.rows.some((row) => row.id === receipt.anchor.id));
  return slotPart ? (configuredParts[slotPart.index - 1] ?? null) : null;
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

export type SlotSubmissionStagePermissionQuestionRow = {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: number;
  is_active: number;
  sort_order: number;
  updated_at: number;
};

export type SlotSubmissionStagePermissionField = {
  id: string;
  enabled: boolean;
  required: boolean;
  label: string;
  description: string;
  placeholder: string;
};

const STAGE_PERMISSION_DEFAULT_ID = "stage_permission";
const STAGE_PERMISSION_DEFAULT_LABEL = "ステージ・素材・権利まわりの使用許可";
const STAGE_PERMISSION_DEFAULT_DESCRIPTION =
  "ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。";
const STAGE_PERMISSION_DEFAULT_PLACEHOLDER =
  "例：自作ステージ / 利用規約確認済み / 権利者許可済み など";

function cleanStagePermissionId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned || fallback;
}

function cleanStagePermissionText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** CURRENT getStagePermissionFieldsForEvents, over the fused row receipt. */
export function resolveSlotSubmissionStagePermissionFields(
  eventIds: readonly string[],
  rows: readonly SlotSubmissionStagePermissionQuestionRow[],
): SlotSubmissionStagePermissionField[] {
  const byId = new Map<string, SlotSubmissionStagePermissionField>();
  for (const eventId of Array.from(new Set(eventIds.filter(Boolean)))) {
    const eventRows = rows.filter((row) => row.event_id === eventId);
    for (let index = 0; index < eventRows.length; index += 1) {
      const row = eventRows[index];
      const fallbackId = index === 0
        ? STAGE_PERMISSION_DEFAULT_ID
        : STAGE_PERMISSION_DEFAULT_ID + "_" + (index + 1);
      const field: SlotSubmissionStagePermissionField = {
        id: cleanStagePermissionId(row.question_key, fallbackId),
        enabled: row.is_active === 1,
        required: row.required === 1,
        label: cleanStagePermissionText(row.label, STAGE_PERMISSION_DEFAULT_LABEL),
        description: cleanStagePermissionText(row.description, STAGE_PERMISSION_DEFAULT_DESCRIPTION),
        placeholder: cleanStagePermissionText(row.placeholder, STAGE_PERMISSION_DEFAULT_PLACEHOLDER),
      };
      if (!field.enabled) continue;
      const existing = byId.get(field.id);
      if (existing) {
        byId.set(field.id, { ...existing, required: existing.required || field.required });
      } else {
        byId.set(field.id, field);
      }
    }
  }
  return Array.from(byId.values());
}

function parseExistingStagePermissionAnswers(raw: string | null | undefined): Map<string, string> {
  if (!raw || !raw.trim()) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const answers = (parsed as { answers?: unknown }).answers;
    if (!Array.isArray(answers)) return new Map();
    const out = new Map<string, string>();
    for (const item of answers) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const data = item as Record<string, unknown>;
      const id = cleanStagePermissionId(data.id, "");
      const value = typeof data.value === "string" ? data.value.trim() : "";
      if (id && value) out.set(id, value);
    }
    return out;
  } catch {
    return new Map();
  }
}

function serializeSlotStagePermissionAnswers(
  answers: readonly { id: string; label: string; value: string }[],
): string | null {
  const cleaned = answers.map((answer) => ({
    id: cleanStagePermissionId(answer.id, ""),
    label: cleanStagePermissionText(answer.label, STAGE_PERMISSION_DEFAULT_LABEL),
    value: answer.value.trim(),
  })).filter((answer) => answer.id && answer.value);
  return cleaned.length === 0 ? null : JSON.stringify({ version: 1, answers: cleaned });
}

/** CURRENT buildStagePermissionSubmission, with no implicit existing-answer fallback by default. */
export function buildSlotSubmissionStagePermissionSubmission(
  formData: FormData,
  fields: readonly SlotSubmissionStagePermissionField[],
  existingAnswersJson?: string | null,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (fields.length === 0) return { ok: true, value: null };
  const ids = formData.getAll("custom_question_answer_id");
  const values = formData.getAll("custom_question_answer_value");
  const submitted = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = String(ids[index] ?? "").trim();
    if (!id) continue;
    submitted.set(id, String(values[index] ?? "").trim());
  }
  const fallback = parseExistingStagePermissionAnswers(existingAnswersJson);
  const answers: { id: string; label: string; value: string }[] = [];
  for (const field of fields) {
    const raw = submitted.has(field.id) ? submitted.get(field.id) : fallback.get(field.id);
    const value = (raw ?? "").trim();
    if (value.length > 1000) {
      return { ok: false, message: field.label + "は1000文字以内で入力してください。" };
    }
    if (field.required && !value) {
      return { ok: false, message: field.label + "を入力してください。" };
    }
    if (value) answers.push({ id: field.id, label: field.label, value });
  }
  return { ok: true, value: serializeSlotStagePermissionAnswers(answers) };
}

export function decodeSlotSubmissionStageQuestionProjection(
  json: string,
  expectedEventIds: readonly string[],
): SlotSubmissionStagePermissionQuestionRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("slot_submission_stage_question_projection_invalid");
  }
  const expected = new Set(expectedEventIds);
  if (!Array.isArray(parsed)) throw new Error("slot_submission_stage_question_projection_invalid");
  const seen = new Set<string>();
  return parsed.map((tuple: unknown) => {
    if (!Array.isArray(tuple) || tuple.length !== 10) {
      throw new Error("slot_submission_stage_question_projection_invalid");
    }
    const [id, eventId, questionKey, label, description, placeholder,
      required, isActive, sortOrder, updatedAt] = tuple;
    if (typeof id !== "string" || !id || seen.has(id) ||
        typeof eventId !== "string" || !expected.has(eventId) ||
        typeof questionKey !== "string" || typeof label !== "string" ||
        (description !== null && typeof description !== "string") ||
        (placeholder !== null && typeof placeholder !== "string") ||
        (required !== 0 && required !== 1) || (isActive !== 0 && isActive !== 1) ||
        !Number.isSafeInteger(sortOrder) || !Number.isSafeInteger(updatedAt)) {
      throw new Error("slot_submission_stage_question_projection_invalid");
    }
    seen.add(id);
    return {
      id, event_id: eventId, question_key: questionKey, label,
      description, placeholder, required, is_active: isActive,
      sort_order: sortOrder, updated_at: updatedAt,
    };
  });
}

export type SlotSubmissionExistingVideo = typeof videos.$inferSelect;
export type SlotSubmissionEventConfig = Pick<typeof events.$inferSelect,
  "id" | "title" | "parts_json" | "slot_part_gap_minutes" | "required_video_fields_json">;

export type SlotSubmissionVideoEventReceipt = {
  existing: { kind: "none" } | { kind: "missing" } |
    { kind: "found"; row: SlotSubmissionExistingVideo };
  targetEventIds: string[];
  events: SlotSubmissionEventConfig[];
  event: SlotSubmissionEventConfig | null;
  eventPolicyJson: string;
  generalQuestionPolicyJson: string;
  stageQuestionPolicyJson: string;
  stageQuestions: SlotSubmissionStagePermissionQuestionRow[];
  youtubeDuplicate: boolean;
};

/**
 * Revalidate the exact part-resolution row set and the event policy row read
 * during SA-088 preflight. The initial snapshot is generated by SQLite JSON1,
 * so unsafe legacy integer values are compared without JS number round-trips.
 * Bounded receipts recheck only the numeric prefix through the anchor; fallback
 * receipts recheck the complete event row set. Event fields include every value
 * used for part assignment, required fields and notification text.
 */
export function buildSlotSubmissionPartAndEventAssertions(
  receipt: SlotSubmissionReceipt,
  videoEventReceipt: SlotSubmissionVideoEventReceipt,
): SQL[] {
  const event = videoEventReceipt.event;
  if (
    receipt.group.kind !== "ready" ||
    !receipt.anchor.id ||
    !Array.isArray(receipt.partResolution?.rows) ||
    (receipt.partResolution.kind !== "bounded" && receipt.partResolution.kind !== "fallback") ||
    typeof receipt.partSnapshotJson !== "string" ||
    !receipt.partSnapshotJson.startsWith("[") ||
    !event ||
    event.id !== receipt.anchor.event_id ||
    !videoEventReceipt.targetEventIds.includes(receipt.anchor.event_id) ||
    !Array.isArray(videoEventReceipt.events) ||
    !videoEventReceipt.events.some((row) => row.id === receipt.anchor.event_id) ||
    typeof videoEventReceipt.eventPolicyJson !== "string" ||
    !videoEventReceipt.eventPolicyJson.startsWith("[")
  ) {
    throw new Error("slot_submission_freshness_receipt_invalid");
  }

  const partScope = receipt.partResolution.kind === "bounded"
    ? sql`AND typeof(start_time) IN ('integer', 'real')
        AND start_time <= (SELECT start_time FROM slots WHERE id = ${receipt.anchor.id})`
    : sql``;
  const actualPartSnapshot = sql`(
    SELECT json_group_array(json_array(id, start_time, sort_order))
    FROM (
      SELECT id, start_time, sort_order
      FROM slots
      WHERE event_id = (SELECT event_id FROM slots WHERE id = ${receipt.anchor.id})
      ${partScope}
      ORDER BY id COLLATE BINARY ASC
    )
  )`;
  const eventIdsJson = JSON.stringify(videoEventReceipt.targetEventIds);
  const actualEventSnapshot = sql`(
    SELECT json_group_array(json_array(id, title, parts_json, slot_part_gap_minutes, required_video_fields_json))
    FROM (
      SELECT events.id, events.title, events.parts_json,
             events.slot_part_gap_minutes, events.required_video_fields_json
      FROM events
      INNER JOIN json_each(${eventIdsJson}) requested
        ON events.id = CAST(requested.value AS TEXT)
      ORDER BY CAST(requested.key AS INTEGER)
    )
  )`;

  return [
    assertCondition(sql`${actualPartSnapshot} = ${receipt.partSnapshotJson}`),
    assertCondition(sql`${actualEventSnapshot} = ${videoEventReceipt.eventPolicyJson}`),
  ];
}

/** Same-batch freshness checks for every stage/general question used by SA-088. */
export function buildSlotSubmissionQuestionPolicyAssertions(
  receipt: SlotSubmissionVideoEventReceipt,
): SQL[] {
  if (!Array.isArray(receipt.targetEventIds) ||
      receipt.targetEventIds.some((id) => typeof id !== "string" || !id) ||
      typeof receipt.generalQuestionPolicyJson !== "string" ||
      !receipt.generalQuestionPolicyJson.startsWith("[") ||
      typeof receipt.stageQuestionPolicyJson !== "string" ||
      !receipt.stageQuestionPolicyJson.startsWith("[")) {
    throw new Error("slot_submission_question_policy_receipt_invalid");
  }
  const eventIdsJson = JSON.stringify(receipt.targetEventIds);
  const actualGeneral = sql`(
    SELECT json_group_array(json_array(
      id, event_id, question_key, label, type, required, options_json,
      max_length, sort_order, visibility, updated_at
    ))
    FROM (
      SELECT event_custom_questions.id, event_custom_questions.event_id,
             event_custom_questions.question_key, event_custom_questions.label,
             event_custom_questions.type, event_custom_questions.required,
             event_custom_questions.options_json, event_custom_questions.max_length,
             event_custom_questions.sort_order, event_custom_questions.visibility,
             event_custom_questions.updated_at
      FROM event_custom_questions
      INNER JOIN json_each(${eventIdsJson}) event_order
        ON event_custom_questions.event_id = CAST(event_order.value AS TEXT)
      WHERE event_custom_questions.is_active = 1
        AND NOT (${stagePermissionQuestionKeyCondition()})
      ORDER BY CAST(CAST(event_order.key AS INTEGER) / ${GENERAL_QUESTION_EVENT_CHUNK_SIZE_SQL} AS INTEGER),
               event_custom_questions.event_id ASC,
               event_custom_questions.sort_order ASC,
               event_custom_questions.id ASC
      LIMIT ${receipt.targetEventIds.length * MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1}
    )
  )`;
  const actualStage = sql`(
    SELECT json_group_array(json_array(
      id, event_id, question_key, label, description, placeholder,
      required, is_active, sort_order, updated_at
    ))
    FROM (
      SELECT id, event_id, question_key, label, description, placeholder,
             required, is_active, sort_order, updated_at
      FROM event_custom_questions
      WHERE event_id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${eventIdsJson})
      )
        AND ${stagePermissionQuestionKeyCondition()}
      ORDER BY event_id ASC, sort_order ASC
    )
  )`;
  return [
    assertCondition(sql`${actualGeneral} = ${receipt.generalQuestionPolicyJson}`),
    assertCondition(sql`${actualStage} = ${receipt.stageQuestionPolicyJson}`),
  ];
}

export function decodeSlotSubmissionGeneralQuestions(
  receipt: SlotSubmissionVideoEventReceipt,
): LoadedGeneralCustomQuestion[] {
  return decodeGeneralCustomQuestionPolicyForEvents(
    receipt.generalQuestionPolicyJson,
    receipt.targetEventIds,
  );
}

type SlotSubmissionVideoEventProjection = {
  [K in keyof SlotSubmissionExistingVideo]: SlotSubmissionExistingVideo[K] | null;
} & {
  receipt_events_json: string;
  receipt_general_questions_json: string;
  receipt_stage_questions_json: string;
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
function decodeSlotSubmissionEventPolicyProjection(
  json: string,
  expectedEventIds: readonly string[],
): SlotSubmissionEventConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("slot_submission_event_policy_projection_invalid");
  }
  const expected = new Set(expectedEventIds);
  if (!Array.isArray(parsed)) throw new Error("slot_submission_event_policy_projection_invalid");
  const seen = new Set<string>();
  return parsed.map((tuple: unknown) => {
    if (!Array.isArray(tuple) || tuple.length !== 5) {
      throw new Error("slot_submission_event_policy_projection_invalid");
    }
    const [id, title, partsJson, gapMinutes, requiredJson] = tuple;
    if (typeof id !== "string" || !expected.has(id) || seen.has(id) ||
        typeof title !== "string" ||
        (partsJson !== null && typeof partsJson !== "string") ||
        (gapMinutes !== null && !Number.isSafeInteger(gapMinutes)) ||
        (requiredJson !== null && typeof requiredJson !== "string")) {
      throw new Error("slot_submission_event_policy_projection_invalid");
    }
    seen.add(id);
    return {
      id,
      title,
      parts_json: partsJson,
      slot_part_gap_minutes: gapMinutes,
      required_video_fields_json: requiredJson,
    } as SlotSubmissionEventConfig;
  });
}

export async function readSlotSubmissionVideoEventReceipt(
  db: Pick<ServerCoreDb, "all">,
  anchor: Pick<SlotSubmissionReceiptRow, "event_id" | "video_id">,
  submittedYoutubeId: string | null,
  targetEventIds: readonly string[] = [anchor.event_id],
): Promise<SlotSubmissionVideoEventReceipt> {
  const ids = Array.from(new Set([anchor.event_id, ...targetEventIds].filter(Boolean)));
  const eventIdsJson = JSON.stringify(ids);
  const videoColumns = sql.join(
    Object.values(getTableColumns(videos)).map((column) => sql`v.${sql.identifier(column.name)}`),
    sql`, `,
  );
  const rows = await db.all<SlotSubmissionVideoEventProjection>(sql`WITH submission_input AS (
    SELECT ${anchor.event_id} AS event_id,
      ${anchor.video_id || null} AS video_id,
      ${submittedYoutubeId || null} AS youtube_id,
      ${eventIdsJson} AS event_ids_json
  ),
  requested_event_ids AS (
    SELECT CAST(value AS TEXT) AS id, CAST(key AS INTEGER) AS ordinal
    FROM json_each((SELECT event_ids_json FROM submission_input))
  )
  SELECT ${videoColumns},
    (SELECT json_group_array(json_array(
      id, title, parts_json, slot_part_gap_minutes, required_video_fields_json
    ))
    FROM (
      SELECT events.id, events.title, events.parts_json,
             events.slot_part_gap_minutes, events.required_video_fields_json
      FROM events
      INNER JOIN requested_event_ids requested
        ON events.id = requested.id
      ORDER BY requested.ordinal
    )) AS receipt_events_json,
    (SELECT json_group_array(json_array(
      id, event_id, question_key, label, type, required, options_json,
      max_length, sort_order, visibility, updated_at
    ))
    FROM (
      SELECT event_custom_questions.id, event_custom_questions.event_id,
             event_custom_questions.question_key, event_custom_questions.label,
             event_custom_questions.type, event_custom_questions.required,
             event_custom_questions.options_json, event_custom_questions.max_length,
             event_custom_questions.sort_order, event_custom_questions.visibility,
             event_custom_questions.updated_at
      FROM event_custom_questions
      INNER JOIN requested_event_ids event_order
        ON event_custom_questions.event_id = event_order.id
      WHERE event_custom_questions.is_active = 1
        AND NOT (${stagePermissionQuestionKeyCondition()})
      ORDER BY CAST(event_order.ordinal / ${GENERAL_QUESTION_EVENT_CHUNK_SIZE_SQL} AS INTEGER),
               event_custom_questions.event_id ASC,
               event_custom_questions.sort_order ASC,
               event_custom_questions.id ASC
      LIMIT ((SELECT COUNT(*) FROM requested_event_ids) * ${MAX_VIDEO_CUSTOM_QUESTIONS_READ} + 1)
    )) AS receipt_general_questions_json,
    (SELECT json_group_array(json_array(
      id, event_id, question_key, label, description, placeholder,
      required, is_active, sort_order, updated_at
    ))
    FROM (
      SELECT id, event_id, question_key, label, description, placeholder,
             required, is_active, sort_order, updated_at
      FROM event_custom_questions
      WHERE event_id IN (SELECT id FROM requested_event_ids)
        AND ${stagePermissionQuestionKeyCondition()}
      ORDER BY event_id ASC, sort_order ASC
    )) AS receipt_stage_questions_json,
    CASE WHEN input.youtube_id IS NULL THEN 0 ELSE EXISTS (
      SELECT 1 FROM videos candidate WHERE candidate.youtube_video_id = input.youtube_id
        AND candidate.visibility_status <> 'voided'
        AND (v.id IS NULL OR candidate.id <> v.id)
      LIMIT 1
    ) END AS receipt_youtube_duplicate
  FROM submission_input input
  LEFT JOIN videos v ON v.id = input.video_id
  LIMIT 1`);
  if (rows.length !== 1) throw new Error("slot_submission_video_event_receipt_invalid");
  const {
    receipt_events_json, receipt_general_questions_json,
    receipt_stage_questions_json, receipt_youtube_duplicate,
    ...video
  } = rows[0];
  if ((receipt_youtube_duplicate !== 0 && receipt_youtube_duplicate !== 1) ||
      (video.id !== null && video.id !== (anchor.video_id || null)) ||
      typeof receipt_events_json !== "string" ||
      typeof receipt_general_questions_json !== "string" ||
      typeof receipt_stage_questions_json !== "string") {
    throw new Error("slot_submission_video_event_receipt_invalid");
  }
  const eventsSnapshot = decodeSlotSubmissionEventPolicyProjection(receipt_events_json, ids);
  const stageQuestions = decodeSlotSubmissionStageQuestionProjection(receipt_stage_questions_json, ids);
  return {
    existing: anchor.video_id
      ? video.id === null ? { kind: "missing" } : { kind: "found", row: video as SlotSubmissionExistingVideo }
      : { kind: "none" },
    targetEventIds: ids,
    events: eventsSnapshot,
    event: eventsSnapshot.find((event) => event.id === anchor.event_id) ?? null,
    eventPolicyJson: receipt_events_json,
    generalQuestionPolicyJson: receipt_general_questions_json,
    stageQuestionPolicyJson: receipt_stage_questions_json,
    stageQuestions,
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

export type SlotSubmissionEventSelectionReceipt = {
  current: string[];
  eventPolicies: { id: string; allow: number }[];
  staffPolicies: { event_id: string; permission_preset: string; custom_permission_keys_json: string | null }[];
};

/** SA-088 event link selection, distinct from SA-086 unslotted eligibility.
 * The receipt is server-owned; its staff rows are already restricted to the
 * approved-X membership predicate. No client-supplied policy or role.
 * Retain CURRENT raw universe cap, trim/dedupe ordering and admin exception.
 */
export function resolveSlotSubmissionEventSelection(
  receipt: SlotSubmissionEventSelectionReceipt,
  requested: readonly string[],
  anchorEventId: string,
  isAdmin: boolean,
): string[] {
  if (receipt.current.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_existing_atomic_limit_exceeded");
  }
  const universe = Array.from(new Set([...receipt.current, ...requested, anchorEventId]));
  if (!isAdmin && universe.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_event_atomic_limit_exceeded");
  }
  const unique = (values: readonly string[]): string[] =>
    Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  const alwaysInclude = unique([anchorEventId]);
  const requestedIds = unique(requested);
  if (isAdmin) return unique([...alwaysInclude, ...requestedIds]);

  // CURRENT getEditableEventIds counts candidate staff rows before resolving
  // presets/custom keys, even if the event's public allow flag is already 1.
  const candidateIds = universe.filter(Boolean);
  if (receipt.staffPolicies.length > candidateIds.length * 4) {
    throw new Error("editable_event_staff_read_limit_exceeded");
  }
  const allowMap = new Map(receipt.eventPolicies.map((row) => [row.id, row.allow]));
  const editable = new Set(receipt.staffPolicies
    .filter((row) => resolveStaffPermissionKeys(row).size > 0)
    .map((row) => row.event_id));
  const modifiable = new Set(universe.filter((id) => allowMap.get(id) === 1 || editable.has(id)));
  const requestedSet = new Set(requestedIds);
  const target = new Set(alwaysInclude);
  for (const id of unique(receipt.current)) {
    if (!modifiable.has(id) || requestedSet.has(id)) target.add(id);
  }
  for (const id of requestedIds) {
    if (modifiable.has(id)) target.add(id);
  }
  return Array.from(target);
}

/** One-statement SA-088 event-link receipt candidate.
 * requested must come from CURRENT parseEventIdsFromForm; videoId is the
 * authorized existing ID or generated new ID. approvedXIds must be trusted,
 * and the eventual atomic plan must reassert membership/policy/role freshness.
 * This does NOT replace that assertion, or add an allowed pre-batch read.
 * At most 5 existing links, 4 policies and 17 staff rows; no usable partial
 * success on overflow. Staff policy text bytes are not bounded by row count.
 */
export async function readSlotSubmissionEventSelection(
  db: Pick<ServerCoreDb, "all">,
  input: {
    videoId: string;
    requested: readonly string[];
    anchorEventId: string;
    isAdmin: boolean;
    approvedXIds: readonly string[];
  },
): Promise<{ receipt: SlotSubmissionEventSelectionReceipt; targetEventIds: string[] }> {
  const receipt: SlotSubmissionEventSelectionReceipt = { current: [], eventPolicies: [], staffPolicies: [] };
  if (input.isAdmin) {
    // CURRENT admin preflight skips event/staff reads and only checks the
    // existing count. Later write-plan limits still apply to the target.
    const rows = await db.all<{ event_id: string }>(sql`
      SELECT event_id FROM video_events WHERE video_id = ${input.videoId}
      LIMIT ${MAX_ATOMIC_VIDEO_EVENTS + 1}`);
    receipt.current = rows.map((row) => row.event_id);
  } else {
    // Distinct raw IDs only; 5 proves an oversized universe without
    // serializing the entire input. Always include the anchor before slicing.
    const requestIds = Array.from(new Set([input.anchorEventId, ...input.requested]))
      .slice(0, MAX_ATOMIC_VIDEO_EVENTS + 1);
    const rows = await db.all<{
      receipt_kind: number; id: string; allow: number | null;
      permission_preset: string | null; custom_permission_keys_json: string | null;
    }>(sql`WITH current_rows AS (
      SELECT event_id FROM video_events WHERE video_id = ${input.videoId}
      LIMIT ${MAX_ATOMIC_VIDEO_EVENTS + 1}
    ), universe AS (
      SELECT event_id AS id FROM current_rows
      UNION
      SELECT CAST(value AS TEXT) AS id FROM json_each(${JSON.stringify(requestIds)})
    ), event_rows AS (
      SELECT events.id, events.allow_user_video_event_links AS allow
      FROM events WHERE id IN (SELECT id FROM universe)
        AND (SELECT COUNT(*) FROM universe) <= ${MAX_ATOMIC_VIDEO_EVENTS}
      LIMIT ${MAX_ATOMIC_VIDEO_EVENTS}
    ), staff_rows AS (
      SELECT event_id, permission_preset, custom_permission_keys_json
      FROM event_staff
      WHERE event_id IN (SELECT id FROM universe WHERE id <> '')
        AND (SELECT COUNT(*) FROM universe) <= ${MAX_ATOMIC_VIDEO_EVENTS}
        AND ${approvedXIdsWhere(eventStaff.x_user_id, input.approvedXIds)}
      LIMIT ${MAX_ATOMIC_VIDEO_EVENTS * 4 + 1}
    )
    SELECT 0 AS receipt_kind, event_id AS id, NULL AS allow,
      NULL AS permission_preset, NULL AS custom_permission_keys_json FROM current_rows
    UNION ALL
    SELECT 1, id, allow, NULL, NULL FROM event_rows
    UNION ALL
    SELECT 2, event_id, NULL, permission_preset, custom_permission_keys_json FROM staff_rows`);
    for (const row of rows) {
      if (row.receipt_kind === 0) receipt.current.push(row.id);
      else if (row.receipt_kind === 1 && typeof row.allow === "number") {
        receipt.eventPolicies.push({ id: row.id, allow: row.allow });
      } else if (row.receipt_kind === 2 && typeof row.permission_preset === "string") {
        receipt.staffPolicies.push({ event_id: row.id, permission_preset: row.permission_preset,
          custom_permission_keys_json: row.custom_permission_keys_json });
      } else throw new Error("slot_submission_event_selection_receipt_invalid");
    }
  }
  return { receipt, targetEventIds: resolveSlotSubmissionEventSelection(
    receipt, input.requested, input.anchorEventId, input.isAdmin,
  ) };
}
