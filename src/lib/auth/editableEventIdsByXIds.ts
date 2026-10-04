import "server-only";

import { and, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { eventStaff } from "@/lib/db/schema";
import { approvedXIdsWhere } from "./approvedX";
import { LEGACY_PERMISSION_KEY_ALIASES } from "./permissions/aliases";
import { ALL_PERMISSION_KEYS } from "./permissions/keys";
import { EVENT_STAFF_PRESETS, PRESET_DEFINITIONS } from "./permissions/presets";

const PRESETS_WITH_PERMISSIONS = EVENT_STAFF_PRESETS.filter(
  (preset) => PRESET_DEFINITIONS[preset].permissions.length > 0,
);
const PERMISSION_KEY_INPUTS_JSON = JSON.stringify([
  ...ALL_PERMISSION_KEYS,
  ...LEGACY_PERMISSION_KEY_ALIASES,
]);

/** Headerは件数を表示しない。許可行を1件だけ見つけるbounded queryを使う。 */
export async function hasEditableEventByApprovedXIds(
  db: DB,
  approvedXUserIds: readonly string[],
): Promise<boolean> {
  const xIds = Array.from(
    new Set(approvedXUserIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (xIds.length === 0) return false;

  // safeParseCustomPermissionKeys と同じく、JSON配列の文字列要素だけを有効keyとして扱う。
  // json_type() は不正JSONでerrorになるため json_valid() で先に分岐する。
  // 定数key一覧は1 bindのJSONで渡し、approved X IDsと合わせたbind上限を圧迫しない。
  const customPermissionExists = sql`(
    ${eventStaff.permission_preset} = 'custom'
    AND EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(${eventStaff.custom_permission_keys_json})
            THEN CASE
              WHEN json_type(${eventStaff.custom_permission_keys_json}) = 'array'
                THEN ${eventStaff.custom_permission_keys_json}
              ELSE '[]'
            END
          ELSE '[]'
        END
      ) AS custom_permission
      WHERE custom_permission.type = 'text'
        AND custom_permission.value IN (
          SELECT value FROM json_each(${PERMISSION_KEY_INPUTS_JSON})
        )
    )
  )`;
  const result = await db
    .select({ event_id: eventStaff.event_id })
    .from(eventStaff)
    .where(
      and(
        approvedXIdsWhere(eventStaff.x_user_id, xIds),
        or(
          inArray(eventStaff.permission_preset, PRESETS_WITH_PERMISSIONS),
          customPermissionExists,
        )!,
      )!,
    )
    .limit(1);
  return result.length > 0;
}
