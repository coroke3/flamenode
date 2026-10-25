import { eq } from "drizzle-orm";
import { systemSettings } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import {
  parseGeneralEditableFields,
  resolveGeneralEditableScope,
  type GeneralEditableFieldKey,
} from "@flamenode/domain/video";

export {
  GENERAL_EDITABLE_FIELD_KEYS,
  GENERAL_EDITABLE_FIELD_LABELS,
  GENERAL_EDITABLE_FIELD_HELP,
  GENERAL_EDITABLE_FIELD_GROUPS,
  OWNER_EDITABLE_FIELD_DEFINITIONS,
  normalizeGeneralEditableFields,
  serializeGeneralEditableFields,
  parseGeneralEditableFields,
  resolveGeneralEditableScope,
  sectionAllowedByGeneralFields,
  disabledFieldKeysFromGeneralFields,
  parseGeneralEditablePolicyV2,
  resolveGeneralEditableFieldsFromPolicy,
  VIDEO_SYSTEM_ONLY_PARAMETER_KEYS,
  type GeneralEditableFieldKey,
  type OwnerEditableFieldDefinition,
  type GeneralEditablePolicyV2,
  type VideoParameterRisk,
} from "@flamenode/domain/video";

export async function loadGeneralEditableFieldSet(
  db: ServerCoreDb,
  video: { visibility_status: string },
): Promise<Set<GeneralEditableFieldKey>> {
  const row = (
    await db
      .select({
        default_editable_fields: systemSettings.default_editable_fields,
        upcoming_editable_fields: systemSettings.upcoming_editable_fields,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];
  if (!row) return new Set();
  const scope = resolveGeneralEditableScope(video);
  const csv =
    scope === "default"
      ? row.default_editable_fields
      : row.upcoming_editable_fields;
  return parseGeneralEditableFields(csv);
}
