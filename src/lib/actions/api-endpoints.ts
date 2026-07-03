"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { events, historyLogs } from "@/lib/db/schema";

export interface ApiEndpointResult {
  ok: boolean;
  message?: string;
  id?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: ApiEndpointResult }
> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) {
    return { ok: false, result: { ok: false, message: "Login is required." } };
  }
  if (user.role !== "admin") {
    return { ok: false, result: { ok: false, message: "Admin access is required." } };
  }
  return { ok: true, userId: user.id };
}

export async function createApiEndpoint(
  formData: FormData,
): Promise<ApiEndpointResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id is required." };

  const db = getDatabase();
  if (!db) return { ok: false, message: "Database is unavailable." };

  const current = (
    await db
      .select({
        id: events.id,
        visibility_status: events.visibility_status,
        public_api_enabled: events.public_api_enabled,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
  )[0];
  if (!current) return { ok: false, message: "Event was not found." };
  if (current.visibility_status !== "public") {
    return { ok: false, message: "Only public events can expose a public API." };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(events)
    .set({ public_api_enabled: 1, updated_at: now })
    .where(eq(events.id, eventId));
  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: eventId,
    action: "UPDATE",
    before_data: JSON.stringify({
      public_api_enabled: current.public_api_enabled ?? 0,
    }),
    after_data: JSON.stringify({ public_api_enabled: 1 }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/api-endpoints");
  return { ok: true, id: eventId, message: "Public API was enabled." };
}

export async function setApiEndpointActive(
  formData: FormData,
): Promise<ApiEndpointResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const id = String(formData.get("id") ?? "").trim();
  const next = Number(formData.get("is_active") ?? 0) === 1 ? 1 : 0;
  if (!id) return { ok: false, message: "id is required." };

  const db = getDatabase();
  if (!db) return { ok: false, message: "Database is unavailable." };

  const current = (
    await db
      .select({
        id: events.id,
        visibility_status: events.visibility_status,
        public_api_enabled: events.public_api_enabled,
      })
      .from(events)
      .where(eq(events.id, id))
      .limit(1)
  )[0];
  if (!current) return { ok: false, message: "Event was not found." };
  if (next === 1 && current.visibility_status !== "public") {
    return { ok: false, message: "Only public events can expose a public API." };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(events)
    .set({ public_api_enabled: next, updated_at: now })
    .where(eq(events.id, id));
  await db.insert(historyLogs).values({
    table_name: "events",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({
      public_api_enabled: current.public_api_enabled ?? 0,
    }),
    after_data: JSON.stringify({ public_api_enabled: next }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/api-endpoints");
  return {
    ok: true,
    id,
    message: next === 1 ? "Public API was enabled." : "Public API was disabled.",
  };
}
