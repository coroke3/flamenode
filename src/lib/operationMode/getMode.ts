import { eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import { resolveOperationMode } from "./resolve";
import type { OperationMode } from "./types";

export async function getOperationMode(db: any): Promise<OperationMode> {
  try {
    const row = await db
      .select({
        operation_mode: systemSettings.operation_mode,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    return resolveOperationMode(row[0]);
  } catch {
    return "normal";
  }
}
