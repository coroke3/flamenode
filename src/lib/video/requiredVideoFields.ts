import { inArray } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { events } from "../db/schema.ts";
import {
  unionRequiredVideoFields,
  type OptionalRequiredVideoField,
} from "@flamenode/domain/video";

/**
 * Legacy compatibility bridge. Canonical definitions live in
 * @flamenode/domain/video (packages/domain/src/video/requiredFields.ts);
 * loadUnionRequiredVideoFields stays here because it reads D1.
 */
export {
  ALWAYS_REQUIRED_VIDEO_FIELDS,
  OPTIONAL_REQUIRED_VIDEO_FIELDS,
  type AlwaysRequiredVideoField,
  type OptionalRequiredVideoField,
  type RequiredVideoField,
  type RequiredVideoFieldWizardStep,
  REQUIRED_VIDEO_FIELD_LABELS,
  REQUIRED_VIDEO_FIELD_WIZARD_STEP,
  REQUIRED_VIDEO_FIELD_GROUPS,
  type RequiredVideoFieldValues,
  parseRequiredVideoFields,
  serializeRequiredVideoFields,
  serializeRequiredVideoFieldsFromForm,
  unionRequiredVideoFields,
  isRequiredVideoFieldFilled,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  formatRequiredVideoFieldSummary,
} from "@flamenode/domain/video";

export async function loadUnionRequiredVideoFields(
  db: DB,
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
