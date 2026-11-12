import { inArray } from "drizzle-orm";
import { events } from "@flamenode/db/schema";
import {
  unionRequiredVideoFields,
  type OptionalRequiredVideoField,
} from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

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
