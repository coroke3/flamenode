import { eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import { resolveOperationMode } from "./resolve";
import type { OperationMode } from "./types";

export async function getOperationMode(db: any): Promise<OperationMode> {
  try {
    const row = await db
      .select({
        operation_mode: systemSettings.operation_mode,
        cost_guard_mode: systemSettings.cost_guard_mode,
        is_maintenance_mode: systemSettings.is_maintenance_mode,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    return resolveOperationMode(row[0]);
  } catch {
    // operation_mode column may not exist yet. Fall back to legacy columns.
  }
  try {
    const row = await db
      .select({
        cost_guard_mode: systemSettings.cost_guard_mode,
        is_maintenance_mode: systemSettings.is_maintenance_mode,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    return resolveOperationMode(row[0]);
  } catch {
    // system_settings may not exist in very old local databases.
  }
  return "normal";
}
