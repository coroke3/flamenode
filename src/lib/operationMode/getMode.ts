import { eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import type { OperationMode } from "./types";

export async function getOperationMode(db: any): Promise<OperationMode> {
  try {
    const row = await db
      .select({ operation_mode: systemSettings.operation_mode })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    const mode = row[0]?.operation_mode;
    if (mode && isValidMode(mode)) return mode;
  } catch {
    // column may not exist yet
  }
  return "normal";
}

function isValidMode(value: string): value is OperationMode {
  return ["normal", "economy", "read_only", "static_only", "maintenance"].includes(value);
}
