import "server-only";
import { auth } from "@/lib/auth";
import { loadDevVarsIfNeeded } from "@/lib/dev/loadDevVars";

loadDevVarsIfNeeded();

export function isAdminSpreadsheetEnabled(): boolean {
  const v = process.env.ADMIN_SPREADSHEET_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface AdminSpreadsheetSession {
  userId: string;
}

export async function requireAdminSpreadsheetApi(): Promise<
  | { ok: true; session: AdminSpreadsheetSession }
  | { ok: false; status: number; error: string }
> {
  if (!isAdminSpreadsheetEnabled()) {
    return { ok: false, status: 404, error: "spreadsheet_disabled" };
  }
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (u.role !== "admin") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, session: { userId: u.id } };
}
