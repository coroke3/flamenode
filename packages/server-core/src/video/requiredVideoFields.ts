import { and, eq, inArray } from "drizzle-orm";
import { events } from "@flamenode/db/schema";
import {
  unionRequiredVideoFields,
  UnslottedEventSyncError,
  type OptionalRequiredVideoField,
} from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { unslottedEventEligibilityWhere } from "./unslottedEventEligibility.ts";

/** MIG-0651 unmounted SA-086 general-question read candidate. */
export { loadGeneralCustomQuestionsForFreeVideo, type LoadedGeneralCustomQuestion } from "./freeVideoCustomQuestionRead.ts";

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
): Promise<{ eventId: string | null; requiredFields: OptionalRequiredVideoField[]; requiredFieldsSnapshot: string | null }> {
  if (!eventId) return { eventId: null, requiredFields: [], requiredFieldsSnapshot: null };
  const row = (
    await db.select({
      id: events.id,
      required_video_fields_json: events.required_video_fields_json,
    }).from(events).where(
      and(eq(events.id, eventId), unslottedEventEligibilityWhere(nowSec))!,
    ).limit(1)
  )[0];
  if (!row) throw new UnslottedEventSyncError("unslotted_event_not_allowed");
  return {
    eventId: row.id,
    requiredFields: unionRequiredVideoFields([row.required_video_fields_json]),
    requiredFieldsSnapshot: row.required_video_fields_json,
  };
}
