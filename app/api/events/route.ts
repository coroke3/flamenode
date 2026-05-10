import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { events as eventsTable } from "@/lib/db/schema";
import { getDatabase } from "@/lib/cloudflare";

/** イベント一覧 JSON。 */
export async function GET(): Promise<Response> {
  const db = getDatabase();
  if (!db) return NextResponse.json({ items: [] });
  const items = await db
    .select()
    .from(eventsTable)
    .orderBy(desc(eventsTable.start_time))
    .limit(60);
  return NextResponse.json({ items });
}
