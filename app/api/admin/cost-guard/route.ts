import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings, historyLogs } from "@/lib/db/schema";

const VALID_MODES = [
  "normal",
  "economy",
  "read_only",
  "static_only",
  "maintenance",
] as const;

export async function POST(req: Request): Promise<Response> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const data = await req.formData();
  const mode = String(data.get("mode") ?? "");
  if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const db = getDatabase();
  if (!db) return NextResponse.json({ error: "no db" }, { status: 500 });
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.select().from(systemSettings).limit(1);
  if (existing[0]) {
    await db
      .update(systemSettings)
      .set({
        cost_guard_mode: mode as never,
        is_maintenance_mode: mode === "maintenance" ? 1 : 0,
        cost_guard_updated_at: now,
        cost_guard_updated_by_user_id: u.id,
      })
      .where(eq(systemSettings.id, existing[0].id));
  } else {
    await db.insert(systemSettings).values({
      id: "default",
      cost_guard_mode: mode as never,
      is_maintenance_mode: mode === "maintenance" ? 1 : 0,
      auto_cost_guard_enabled: 1,
      cost_guard_updated_at: now,
      cost_guard_updated_by_user_id: u.id,
    });
  }

  await db.insert(historyLogs).values({
    table_name: "system_settings",
    record_id: "default",
    action: "UPDATE",
    before_data: JSON.stringify({ cost_guard_mode: existing[0]?.cost_guard_mode ?? null }),
    after_data: JSON.stringify({ cost_guard_mode: mode }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  return NextResponse.redirect(
    new URL("/admin/cost-guard", req.url),
    { status: 303 },
  );
}
