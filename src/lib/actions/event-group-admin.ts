"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { eventGroupEvents, eventGroups, events } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { buildEventGroupChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import { generateId } from "@/lib/utils/id";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";

export interface EventGroupActionResult extends PendingPublicReflection {
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
  | { ok: true; userId: string; db: DB }
  | { ok: false; result: EventGroupActionResult }
> {
  const guard = await requireAdminWrite("admin_event_create");
  if (!guard.ok) {
    return { ok: false, result: { ok: false, message: guard.message } };
  }
  return { ok: true, userId: guard.user.id, db: guard.db };
}

function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

function normalizeOptionalColor(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

async function ensureUniqueSlug(
  db: DB,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const conditions = [eq(eventGroups.slug, slug)];
  if (excludeId) conditions.push(ne(eventGroups.id, excludeId));
  const existing = await db
    .select({ id: eventGroups.id })
    .from(eventGroups)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .limit(1);
  return existing.length === 0;
}

function groupSnapshot(
  row: typeof eventGroups.$inferSelect,
): Record<string, unknown> {
  return { ...row };
}

function relationSnapshot(
  row: typeof eventGroupEvents.$inferSelect,
): Record<string, unknown> {
  return { ...row };
}

async function mutateEventGroupWithQueue(
  db: DB,
  input: {
    mutationStatements: Parameters<typeof mutateWithAudit>[1]["mutationStatements"];
    expectedMutationChanges: number[];
    audits: Parameters<typeof mutateWithAudit>[1]["audits"];
    reason: string;
    requestedByUserId: string;
  },
): Promise<boolean> {
  const queue = await buildEventGroupChangeQueueBatch(db, input);
  await mutateWithAudit(db, {
    mutationStatements: [...input.mutationStatements, ...queue.statements],
    expectedMutationChanges: [
      ...input.expectedMutationChanges,
      ...queue.expectedChanges,
    ],
    audits: input.audits,
    staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
  });
  return queue.statements.length > 0;
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

  const db = guard.db;

  const data = parsed.data;
  if (!(await ensureUniqueSlug(db, data.slug))) {
    return { ok: false, message: "このスラッグは既に使われています。" };
  }

  const id = data.id?.trim() || generateId("egrp");
  const now = Math.floor(Date.now() / 1000);
  const createdRow = {
    id,
    name: data.name,
    slug: data.slug,
    description: data.description?.trim() || null,
    group_type: data.group_type,
    icon_url: normalizeOptionalUrl(data.icon_url),
    img_url: null,
    accent_color: normalizeOptionalColor(data.accent_color),
    visibility_status: data.visibility_status,
    sort_order: data.sort_order ?? 0,
    created_at: now,
    updated_at: now,
  } satisfies typeof eventGroups.$inferInsert;

  const staticRebuildEnqueued = await mutateEventGroupWithQueue(db, {
    mutationStatements: [db.insert(eventGroups).values(createdRow)],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "event_groups",
        target_id: id,
        operation: "CREATE",
        after: groupSnapshot(createdRow as typeof eventGroups.$inferSelect),
        actor_user_id: guard.userId,
        retention_class: "restorable",
      },
    ],
    reason: "event_group_create",
    requestedByUserId: guard.userId,
  });

  revalidatePath("/admin/event-groups");
  revalidatePath("/event");
  return markPendingPublicReflection({ ok: true, id }, staticRebuildEnqueued);
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

  const db = guard.db;

  const existing = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  const data = parsed.data;
  if (!(await ensureUniqueSlug(db, data.slug, id))) {
    return { ok: false, message: "このスラッグは既に使われています。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const updatedValues = {
    name: data.name,
    slug: data.slug,
    description: data.description?.trim() || null,
    group_type: data.group_type,
    icon_url: normalizeOptionalUrl(data.icon_url),
    img_url: null,
    accent_color: normalizeOptionalColor(data.accent_color),
    visibility_status: data.visibility_status,
    sort_order: data.sort_order ?? existing.sort_order,
    updated_at: now,
  } satisfies Partial<typeof eventGroups.$inferInsert>;
  const updatedRow = { ...existing, ...updatedValues };

  const staticRebuildEnqueued = await mutateEventGroupWithQueue(db, {
    mutationStatements: [
      db
        .update(eventGroups)
        .set(updatedValues)
        .where(
          and(eq(eventGroups.id, id), eq(eventGroups.updated_at, existing.updated_at)),
        ),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "event_groups",
        target_id: id,
        operation: "UPDATE",
        before: groupSnapshot(existing),
        after: groupSnapshot(updatedRow),
        actor_user_id: guard.userId,
        retention_class: "restorable",
      },
    ],
    reason: "event_group_update",
    requestedByUserId: guard.userId,
  });

  revalidatePath("/admin/event-groups");
  revalidatePath(`/admin/event-groups/${id}/edit`);
  revalidatePath("/event");
  return markPendingPublicReflection({ ok: true, id }, staticRebuildEnqueued);
}

export async function deleteEventGroup(
  groupId: string,
): Promise<EventGroupActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const id = groupId.trim();
  if (!id) return { ok: false, message: "ID が必要です。" };

  const db = guard.db;

  const existing = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  const relationRows = await db
    .select()
    .from(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, id));
  await mutateEventGroupWithQueue(db, {
    mutationStatements: [
      db.delete(eventGroupEvents).where(eq(eventGroupEvents.event_group_id, id)),
      db
        .delete(eventGroups)
        .where(
          and(eq(eventGroups.id, id), eq(eventGroups.updated_at, existing.updated_at)),
        ),
    ],
    expectedMutationChanges: [relationRows.length, 1],
    audits: [
      ...relationRows.map((row) => ({
        table_name: "event_group_events" as const,
        target_id: `${row.event_group_id}:${row.event_id}`,
        operation: "DELETE" as const,
        before: relationSnapshot(row),
        actor_user_id: guard.userId,
        retention_class: "restorable" as const,
      })),
      {
        table_name: "event_groups",
        target_id: id,
        operation: "DELETE" as const,
        before: groupSnapshot(existing),
        actor_user_id: guard.userId,
        retention_class: "restorable" as const,
      },
    ],
    reason: "event_group_delete",
    requestedByUserId: guard.userId,
  });

  revalidatePath("/admin/event-groups");
  revalidatePath("/event");
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

  const db = guard.db;

  const group = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
  )[0];
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  const existingRows = await db
    .select()
    .from(eventGroupEvents)
    .where(eq(eventGroupEvents.event_group_id, groupId));
  const existingIds = new Set(existingRows.map((row) => row.event_id));
  const validRows = await db
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.id, eventIds));
  if (validRows.length !== eventIds.length) {
    return { ok: false, message: "存在しないイベントは追加できません。" };
  }
  const toAdd = eventIds.filter((id) => !existingIds.has(id));
  if (toAdd.length === 0) {
    return { ok: false, message: "追加できるイベントがありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const insertedRows = toAdd.map(
    (eventId) =>
      ({
        event_group_id: groupId,
        event_id: eventId,
        relation_type: "member",
        created_at: now,
        updated_at: now,
      }) satisfies typeof eventGroupEvents.$inferInsert,
  );

  await mutateEventGroupWithQueue(db, {
    mutationStatements: [db.insert(eventGroupEvents).values(insertedRows)],
    expectedMutationChanges: [insertedRows.length],
    audits: insertedRows.map((row) => ({
      table_name: "event_group_events" as const,
      target_id: `${row.event_group_id}:${row.event_id}`,
      operation: "CREATE" as const,
      after: relationSnapshot(row as typeof eventGroupEvents.$inferSelect),
      actor_user_id: guard.userId,
      retention_class: "restorable" as const,
    })),
    reason: "event_group_member_add",
    requestedByUserId: guard.userId,
  });

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath("/event");
  return { ok: true, id: groupId, added: toAdd.length };
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

  const db = guard.db;

  const group = (
    await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
  )[0];
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  const relation = (
    await db
      .select()
      .from(eventGroupEvents)
      .where(
        and(
          eq(eventGroupEvents.event_group_id, groupId),
          eq(eventGroupEvents.event_id, eventId),
        ),
      )
      .limit(1)
  )[0];
  if (!relation) {
    return { ok: false, message: "イベントはグループに追加されていません。" };
  }

  await mutateEventGroupWithQueue(db, {
    mutationStatements: [
      db
        .delete(eventGroupEvents)
        .where(
          and(
            eq(eventGroupEvents.event_group_id, groupId),
            eq(eventGroupEvents.event_id, eventId),
            eq(eventGroupEvents.updated_at, relation.updated_at),
          ),
        ),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "event_group_events",
        target_id: `${groupId}:${eventId}`,
        operation: "DELETE",
        before: relationSnapshot(relation),
        actor_user_id: guard.userId,
        retention_class: "restorable",
      },
    ],
    reason: "event_group_member_remove",
    requestedByUserId: guard.userId,
  });

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath("/event");
  return { ok: true, id: groupId };
}
