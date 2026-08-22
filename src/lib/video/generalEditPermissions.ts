import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import {
  parseGeneralEditableFields,
  resolveGeneralEditableScope,
  type GeneralEditableFieldKey,
} from "./generalEditPermissionsCore";

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
  normalModeAlwaysDisabledFieldKeys,
  NORMAL_MODE_ALWAYS_DISABLED_FIELD_KEYS,
  type GeneralEditableFieldKey,
  type OwnerEditableFieldDefinition,
} from "./generalEditPermissionsCore";

export async function loadGeneralEditableFieldSet(
  db: DB,
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
