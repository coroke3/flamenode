import "server-only";

import { getEnv, waitForLocalBindings } from "@/lib/cloudflare";
import { SPREADSHEET_ERROR } from "./errors";

export async function getSpreadsheetD1(): Promise<D1Database> {
  try {
    await waitForLocalBindings();
    const db = getEnv().DB;
    if (db && typeof db.prepare === "function") {
      return db;
    }
  } catch {
    /* db_unavailable へ */
  }
  throw new Error(SPREADSHEET_ERROR.DB_UNAVAILABLE);
}
