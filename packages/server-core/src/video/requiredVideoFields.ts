import { and, eq, inArray, sql } from "drizzle-orm";
import { eventCustomQuestions, events, videos } from "@flamenode/db/schema";
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
): Promise<{ eventId: string | null; requiredFields: OptionalRequiredVideoField[]; requiredFieldsSnapshot: string | null; youtubeDuplicate: boolean | null; questionPolicyJson?: string }> {
  if (!eventId) return {
    eventId: null, requiredFields: [], requiredFieldsSnapshot: null, youtubeDuplicate: null,
    ...(includeQuestionPolicy ? { questionPolicyJson: "[]" } : {}),
  };
  const row = (
    await db.select({
      id: events.id,
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
  };
}
