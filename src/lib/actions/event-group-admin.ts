"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventGroupEvents,
  eventGroups,
  events,
  historyLogs,
} from "@/lib/db/schema";
import { enqueueAfterEventGroupChange } from "@/lib/staticRebuild/hooks";
import { generateId } from "@/lib/utils/id";

export interface EventGroupActionResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const groupTypeEnum = z.enum([
  "series",
  "genre",
  "related",
  "collection",
  "other",
]);
const visibilityEnum = z.enum(["public", "private", "archived"]);
const relationTypeEnum = z.enum(["member", "primary", "related"]);

const groupSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "スラッグは小文字英数字とハイフンのみ"),
  description: z.string().trim().max(2000).optional().nullable(),
  group_type: groupTypeEnum.default("series"),
  icon_url: z.string().trim().max(500).optional().nullable(),
  img_url: z.string().trim().max(500).optional().nullable(),
  accent_color: z
    .string()
    .trim()
    .max(32)
    .regex(/^$|^#[0-9a-fA-F]{3,8}$/, "アクセント色は #RRGGBB 形式")
    .optional()
    .nullable(),
  visibility_status: visibilityEnum.default("public"),
  sort_order: z.coerce.number().int().min(-9999).max(9999).default(0).optional(),
});

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: EventGroupActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) {
    return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  }
  if (u.role !== "admin") {
    return {
      ok: false,
      result: { ok: false, message: "管理者のみ操作できます。" },
    };
  }
  return { ok: true, userId: u.id };
}

function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

function normalizeOptionalColor(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

async function fetchGroupEventIds(db: NonNullable<ReturnType<typeof getDatabase>>, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ event_id: eventGroupEvents.event_id })
    .from(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, groupId));
  return rows.map((r) => r.event_id);
}

async function ensureUniqueSlug(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const conds = [eq(eventGroups.slug, slug)];
  if (excludeId) conds.push(ne(eventGroups.id, excludeId));
  const existing = await db
    .select({ id: eventGroups.id })
    .from(eventGroups)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .limit(1);
  return existing.length === 0;
}

export async function createEventGroup(
  formData: FormData,
): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const d = parsed.data;
  if (!(await ensureUniqueSlug(db, d.slug))) {
    return { ok: false, message: "このスラッグは既に使われています。" };
  }

  const id = d.id?.trim() || generateId("egrp");
  const now = Math.floor(Date.now() / 1000);

  await db.insert(eventGroups).values({
    id,
    name: d.name,
    slug: d.slug,
    description: d.description?.trim() || null,
    group_type: d.group_type,
    icon_url: normalizeOptionalUrl(d.icon_url),
    img_url: null,
    accent_color: normalizeOptionalColor(d.accent_color),
    visibility_status: d.visibility_status,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "event_groups",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ name: d.name, slug: d.slug }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: d.slug,
    reason: "event_group_create",
    requestedByUserId: guard.userId,
    priority: "high",
  });

  revalidatePath("/admin/event-groups");
  revalidatePath("/groups");
  return { ok: true, id };
}

export async function updateEventGroup(
  formData: FormData,
): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const id = parsed.data.id?.trim();
  if (!id) return { ok: false, message: "ID が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  const d = parsed.data;
  if (!(await ensureUniqueSlug(db, d.slug, id))) {
    return { ok: false, message: "このスラッグは既に使われています。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const eventIds = await fetchGroupEventIds(db, id);

  await db
    .update(eventGroups)
    .set({
      name: d.name,
      slug: d.slug,
      description: d.description?.trim() || null,
      group_type: d.group_type,
      icon_url: normalizeOptionalUrl(d.icon_url),
      img_url: null,
      accent_color: normalizeOptionalColor(d.accent_color),
      visibility_status: d.visibility_status,
      sort_order: 0,
      updated_at: now,
    })
    .where(eq(eventGroups.id, id));

  await db.insert(historyLogs).values({
    table_name: "event_groups",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({ name: existing.name, slug: existing.slug }),
    after_data: JSON.stringify({ name: d.name, slug: d.slug }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: d.slug,
    previousSlug: existing.slug,
    eventIds,
    reason: "event_group_update",
    requestedByUserId: guard.userId,
    priority: "high",
  });

  revalidatePath("/admin/event-groups");
  revalidatePath(`/admin/event-groups/${id}/edit`);
  revalidatePath("/groups");
  revalidatePath(`/groups/${d.slug}`);
  return { ok: true, id };
}

export async function deleteEventGroup(
  groupId: string,
): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const id = groupId.trim();
  if (!id) return { ok: false, message: "ID が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  const eventIds = await fetchGroupEventIds(db, id);
  const now = Math.floor(Date.now() / 1000);

  await db
    .delete(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, id));
  await db.delete(eventGroups).where(eq(eventGroups.id, id));

  await db.insert(historyLogs).values({
    table_name: "event_groups",
    record_id: id,
    action: "DELETE",
    before_data: JSON.stringify({ name: existing.name, slug: existing.slug }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: existing.slug,
    eventIds,
    reason: "event_group_delete",
    requestedByUserId: guard.userId,
    priority: "high",
  });

  revalidatePath("/admin/event-groups");
  revalidatePath("/groups");
  return { ok: true };
}

export async function addEventsToGroup(input: {
  groupId: string;
  eventIds: string[];
}): Promise<EventGroupActionResult & { added?: number }> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const groupId = input.groupId.trim();
  const eventIds = [...new Set(input.eventIds.map((id) => id.trim()).filter(Boolean))];
  if (!groupId || eventIds.length === 0) {
    return { ok: false, message: "追加するイベントを選択してください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const group = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
  )[0];
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  const existingRows = await db
    .select({ event_id: eventGroupEvents.event_id })
    .from(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, groupId));
  const existingIds = new Set(existingRows.map((r) => r.event_id));

  const validRows = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.id, eventIds));
  const validIdSet = new Set(validRows.map((r) => r.id));
  const toAdd = eventIds.filter((id) => validIdSet.has(id) && !existingIds.has(id));
  if (toAdd.length === 0) {
    return { ok: false, message: "追加できるイベントがありません。" };
  }

  const now = Math.floor(Date.now() / 1000);

  for (const eventId of toAdd) {
    await db.insert(eventGroupEvents).values({
      event_group_id: groupId,
      event_id: eventId,
      relation_type: "member",
      sort_order: 0,
      created_at: now,
      updated_at: now,
    });
  }

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: group.slug,
    eventIds: toAdd,
    reason: "event_group_member_add",
    requestedByUserId: guard.userId,
  });

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath("/groups");
  revalidatePath(`/groups/${group.slug}`);
  return { ok: true, id: groupId, added: toAdd.length };
}

export async function addEventToGroup(input: {
  groupId: string;
  eventId: string;
  relationType?: "member" | "primary" | "related";
}): Promise<EventGroupActionResult> {
  const r = await addEventsToGroup({
    groupId: input.groupId,
    eventIds: [input.eventId],
  });
  return { ok: r.ok, message: r.message, id: r.id };
}

export async function removeEventFromGroup(input: {
  groupId: string;
  eventId: string;
}): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const groupId = input.groupId.trim();
  const eventId = input.eventId.trim();
  if (!groupId || !eventId) {
    return { ok: false, message: "グループとイベントを指定してください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const group = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
  )[0];
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  await db
    .delete(eventGroupEvents)
    .where(
      and(
        eq(eventGroupEvents.event_group_id, groupId),
        eq(eventGroupEvents.event_id, eventId),
      ),
    );

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: group.slug,
    eventIds: [eventId],
    reason: "event_group_member_remove",
    requestedByUserId: guard.userId,
  });

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath("/groups");
  revalidatePath(`/groups/${group.slug}`);
  return { ok: true, id: groupId };
}

/** @deprecated UI からは未使用。互換のため残す。 */
export async function updateGroupMemberRelation(input: {
  groupId: string;
  eventId: string;
  relationType: "member" | "primary" | "related";
  sortOrder: number;
}): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const groupId = input.groupId.trim();
  const eventId = input.eventId.trim();
  const relationParsed = relationTypeEnum.safeParse(input.relationType);
  if (!groupId || !eventId || !relationParsed.success) {
    return { ok: false, message: "入力が不正です。" };
  }

  const sortOrder = Math.max(0, Math.min(9999, Math.floor(input.sortOrder)));

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const group = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
  )[0];
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(eventGroupEvents)
    .set({
      relation_type: relationParsed.data,
      sort_order: sortOrder,
      updated_at: now,
    })
    .where(
      and(
        eq(eventGroupEvents.event_group_id, groupId),
        eq(eventGroupEvents.event_id, eventId),
      ),
    );

  await enqueueAfterEventGroupChange(db, {
    db,
    slug: group.slug,
    eventIds: [eventId],
    reason: "event_group_member_update",
    requestedByUserId: guard.userId,
  });

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath(`/groups/${group.slug}`);
  return { ok: true, id: groupId };
}
