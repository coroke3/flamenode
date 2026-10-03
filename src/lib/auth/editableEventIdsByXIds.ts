import "server-only";

import { and, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { eventStaff } from "@/lib/db/schema";
import { approvedXIdsWhere } from "./approvedX";
import { LEGACY_PERMISSION_KEY_ALIASES } from "./permissions/aliases";
import { ALL_PERMISSION_KEYS } from "./permissions/keys";
import { EVENT_STAFF_PRESETS, PRESET_DEFINITIONS } from "./permissions/presets";
import {
  resolveStaffPermissionKeys,
  type StaffPermissionRow,
} from "./permissions/permissionResolver";

function staffRowHasAnyPermissions(row: StaffPermissionRow): boolean {
  return resolveStaffPermissionKeys(row).size > 0;
}

const staffPermissionSelect = {
  permission_preset: eventStaff.permission_preset,
  custom_permission_keys_json: eventStaff.custom_permission_keys_json,
} as const;

const PRESETS_WITH_PERMISSIONS = EVENT_STAFF_PRESETS.filter(
  (preset) => PRESET_DEFINITIONS[preset].permissions.length > 0,
);
const PERMISSION_KEY_INPUTS = [
  ...ALL_PERMISSION_KEYS,
  ...LEGACY_PERMISSION_KEY_ALIASES,
];

/** Headerは件数を表示しない。許可行を1件だけ見つけるbounded queryを使う。 */
export async function hasEditableEventByApprovedXIds(
  db: DB,
  approvedXUserIds: readonly string[],
): Promise<boolean> {
  const xIds = Array.from(
    new Set(approvedXUserIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (xIds.length === 0) return false;

  const validPermissionKeys = sql.join(
    PERMISSION_KEY_INPUTS.map((permissionKey) => sql`${permissionKey}`),
    sql`, `,
  );
  const customPermissionExists = sql`(
    ${eventStaff.permission_preset} = 'custom'
    AND EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(${eventStaff.custom_permission_keys_json})
            THEN ${eventStaff.custom_permission_keys_json}
          ELSE '[]'
        END
      ) AS custom_permission
      WHERE custom_permission.type = 'text'
        AND custom_permission.value IN (${validPermissionKeys})
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

/**
 * 同一request内でDBから確認済みの approved X IDs を再利用する管理アクセスquery。
 * 外部入力を認可根拠として渡す用途では使わない。
 */
export async function getEditableEventIdsByApprovedXIds(
  db: DB,
  approvedXUserIds: readonly string[],
  candidateEventIds?: readonly string[],
): Promise<string[]> {
  const xIds = Array.from(
    new Set(approvedXUserIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (xIds.length === 0) return [];
  const candidateIds = candidateEventIds
    ? Array.from(new Set(candidateEventIds.filter(Boolean)))
    : null;
  if (candidateIds && candidateIds.length === 0) return [];

  const rowsQuery = db
    .select({
      event_id: eventStaff.event_id,
      ...staffPermissionSelect,
    })
    .from(eventStaff)
    .where(
      candidateIds
        ? and(
            approvedXIdsWhere(eventStaff.x_user_id, xIds),
            inArray(eventStaff.event_id, candidateIds),
          )!
        : approvedXIdsWhere(eventStaff.x_user_id, xIds),
    );
  const rows = candidateIds
    ? await rowsQuery.limit(candidateIds.length * 4 + 1)
    : await rowsQuery;
  if (candidateIds && rows.length > candidateIds.length * 4) {
    throw new Error("editable_event_staff_read_limit_exceeded");
  }
  return Array.from(
    new Set(rows.filter(staffRowHasAnyPermissions).map((row) => row.event_id)),
  );
}
