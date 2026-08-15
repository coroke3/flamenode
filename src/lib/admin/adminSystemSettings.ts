import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";

/**
 * 管理画面の同一リクエスト内で共有する system_settings の最小正本。
 *
 * 管理layoutのCostGuardバナーと各ページの運用表示が同時に呼ばれるため、
 * React cache()だけでD1 readをdedupeし、設定の正本を別の保存先へ複製しない。
 */
type SystemSettingsRow = typeof systemSettings.$inferSelect;

export type AdminSystemSettings = {
  operation_mode: SystemSettingsRow["operation_mode"];
  cost_guard_reason: SystemSettingsRow["cost_guard_reason"];
  cost_guard_updated_at: SystemSettingsRow["cost_guard_updated_at"];
  cost_guard_exception_until: SystemSettingsRow["cost_guard_exception_until"];
  cost_guard_exception_features_json: SystemSettingsRow["cost_guard_exception_features_json"];
  default_editable_fields: SystemSettingsRow["default_editable_fields"];
  upcoming_editable_fields: SystemSettingsRow["upcoming_editable_fields"];
};

export const readAdminSystemSettings = cache(
  async (db: DB): Promise<AdminSystemSettings | null> => {
    const rows = await db
      .select({
        operation_mode: systemSettings.operation_mode,
        cost_guard_reason: systemSettings.cost_guard_reason,
        cost_guard_updated_at: systemSettings.cost_guard_updated_at,
        cost_guard_exception_until: systemSettings.cost_guard_exception_until,
        cost_guard_exception_features_json:
          systemSettings.cost_guard_exception_features_json,
        default_editable_fields: systemSettings.default_editable_fields,
        upcoming_editable_fields: systemSettings.upcoming_editable_fields,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    return rows[0] ?? null;
  },
);
