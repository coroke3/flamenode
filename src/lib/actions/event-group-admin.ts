"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { eventGroupEvents, eventGroups, events } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { planD1AuditMutationBudget } from "@/lib/audit/mutateBudget";
import { buildEventGroupChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  queryEventGroupEventOptions,
  type EventGroupEventOptionsPage,
} from "@/lib/admin/eventGroupEventOptions";
import { generateId } from "@/lib/utils/id";
import {
  compensateEventGroupVisibilityOnD1Failure,
  planEventGroupVisibilityFenceTransition,
  preCommitEventGroupVisibilityTransition,
  type EventGroupVisibilityFencePlan,
} from "@/lib/event/eventGroupVisibilityTransition";
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
  base_updated_at: z.coerce.number().int().nonnegative().optional().nullable(),
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

function eventGroupMutationError(error: unknown): EventGroupActionResult {
  unstable_rethrow(error);
  console.error("[event-group] atomic mutation failed", error);
  return {
    ok: false,
    message: "保存に失敗しました。再読み込みして、もう一度お試しください。",
  };
}

const EVENT_GROUP_ADD_MAX = 80;

export async function searchEventGroupEventOptions(input: unknown): Promise<
  | ({ ok: true } & EventGroupEventOptionsPage)
  | { ok: false; message: string }
> {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return {
      ok: false,
      message: guard.result.message ?? "管理者権限が必要です。",
    };
  }
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const request = {
    groupId: typeof raw.groupId === "string" ? raw.groupId : "",
    query: typeof raw.query === "string" ? raw.query : null,
    cursor: typeof raw.cursor === "string" ? raw.cursor : null,
  };
  try {
    const page = await queryEventGroupEventOptions(guard.db, request);
    return { ok: true, ...page };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[event-group] event option search failed", {
      groupId: request.groupId,
      error,
    });
    return {
      ok: false,
      message: "イベント候補の取得に失敗しました。もう一度お試しください。",
    };
  }
}

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
    groupId: string;
    visibilityFence?: EventGroupVisibilityFencePlan;
  },
): Promise<boolean> {
  const fence = input.visibilityFence;
  let fenceWasPreCommitted = false;
  let queue: Awaited<ReturnType<typeof buildEventGroupChangeQueueBatch>> | null = null;
  try {
    queue = await buildEventGroupChangeQueueBatch(db, input);
    const mutationStatements = [
      ...input.mutationStatements,
      ...(fence?.mutationStatements ?? []),
      ...queue.statements,
    ];
    const expectedMutationChanges = [
      ...input.expectedMutationChanges,
      ...(fence?.expectedMutationChanges ?? []),
      ...queue.expectedChanges,
    ];
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: mutationStatements.length,
      mutationAssertionCount: expectedMutationChanges.length,
      auditEntryCount: input.audits.length,
      distinctActorCount: new Set(
        input.audits.map((audit) => audit.actor_user_id),
      ).size,
    });
    if (!budget.withinLimit) {
      throw new Error(
        `この操作は原子更新上限を超えています（${budget.totalQueryCount}/${budget.limit} query）。対象を分けて実行してください`,
      );
    }
    if (fence?.fenceToken) {
      await preCommitEventGroupVisibilityTransition({
        groupId: input.groupId,
        fenceToken: fence.fenceToken,
        reason: input.reason,
      });
      fenceWasPreCommitted = true;
    }
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits: input.audits,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (fence?.fenceToken && fenceWasPreCommitted) {
      try {
        await compensateEventGroupVisibilityOnD1Failure({
          db,
          groupId: input.groupId,
          fenceToken: fence.fenceToken,
        });
      } catch (compensationError) {
        console.warn("[event-group] visibility compensation failed", {
          groupId: input.groupId,
          error: compensationError,
        });
      }
    }
    throw error;
  }
  return Boolean(queue?.statements.length);
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
  let slugAvailable: boolean;
  try {
    slugAvailable = await ensureUniqueSlug(db, data.slug);
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!slugAvailable) {
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
  let visibilityFence: EventGroupVisibilityFencePlan | undefined;
  try {
    visibilityFence =
      data.visibility_status === "public"
        ? await planEventGroupVisibilityFenceTransition({
            db,
            groupId: id,
            previousStatus: "private",
            nextStatus: "public",
            actorUserId: guard.userId,
            reason: "event_group_create",
            now,
          })
        : undefined;
  } catch (error) {
    return eventGroupMutationError(error);
  }

  let staticRebuildEnqueued: boolean;
  try {
    staticRebuildEnqueued = await mutateEventGroupWithQueue(db, {
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
      groupId: id,
      visibilityFence,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }

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

  let existing: typeof eventGroups.$inferSelect | undefined;
  try {
    existing = (
      await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
    )[0];
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  const data = parsed.data;
  let slugAvailable: boolean;
  try {
    slugAvailable = await ensureUniqueSlug(db, data.slug, id);
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!slugAvailable) {
    return { ok: false, message: "このスラッグは既に使われています。" };
  }

  if (data.base_updated_at == null || data.base_updated_at !== existing.updated_at) {
    return {
      ok: false,
      message: "他の操作で更新されています。再読み込みして確認してください。",
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const updatedValues = {
    name: data.name,
    slug: data.slug,
    description: data.description?.trim() || null,
    group_type: data.group_type,
    icon_url: normalizeOptionalUrl(data.icon_url),
    accent_color: normalizeOptionalColor(data.accent_color),
    visibility_status: data.visibility_status,
    sort_order: data.sort_order ?? existing.sort_order,
    updated_at: Math.max(now, existing.updated_at + 1),
  } satisfies Partial<typeof eventGroups.$inferInsert>;
  const updatedRow = { ...existing, ...updatedValues };
  let visibilityFence: EventGroupVisibilityFencePlan;
  try {
    visibilityFence = await planEventGroupVisibilityFenceTransition({
      db,
      groupId: id,
      previousStatus: existing.visibility_status,
      nextStatus: updatedValues.visibility_status,
      actorUserId: guard.userId,
      reason: "event_group_visibility_update",
      now,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }

  let staticRebuildEnqueued: boolean;
  try {
    staticRebuildEnqueued = await mutateEventGroupWithQueue(db, {
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
    groupId: id,
    visibilityFence,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }

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

  const id = typeof groupId === "string" ? groupId.trim() : "";
  if (!id) return { ok: false, message: "ID が必要です。" };

  const db = guard.db;

  let existing: typeof eventGroups.$inferSelect | undefined;
  try {
    existing = (
      await db.select().from(eventGroups).where(eq(eventGroups.id, id)).limit(1)
    )[0];
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!existing) return { ok: false, message: "グループが見つかりません。" };

  let relationRows: (typeof eventGroupEvents.$inferSelect)[];
  try {
    relationRows = await db
      .select()
      .from(eventGroupEvents)
      .where(eq(eventGroupEvents.event_group_id, id));
  } catch (error) {
    return eventGroupMutationError(error);
  }
  const now = Math.floor(Date.now() / 1000);
  let visibilityFence: EventGroupVisibilityFencePlan;
  try {
    visibilityFence = await planEventGroupVisibilityFenceTransition({
      db,
      groupId: id,
      previousStatus: existing.visibility_status,
      nextStatus: "archived",
      actorUserId: guard.userId,
      reason: "event_group_delete",
      now,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }
  try {
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
    groupId: id,
    visibilityFence,
  });

  } catch (error) {
    return eventGroupMutationError(error);
  }
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

  const groupId = typeof input?.groupId === "string" ? input.groupId.trim() : "";
  const rawEventIds = Array.isArray(input?.eventIds) ? input.eventIds : [];
  const eventIds = [
    ...new Set(
      rawEventIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (eventIds.length > EVENT_GROUP_ADD_MAX) {
    return {
      ok: false,
      message: `一度に追加できるイベントは${EVENT_GROUP_ADD_MAX}件までです。分けて実行してください。`,
    };
  }
  if (!groupId || eventIds.length === 0) {
    return { ok: false, message: "追加するイベントを選択してください。" };
  }

  const db = guard.db;

  let group: typeof eventGroups.$inferSelect | undefined;
  try {
    group = (
      await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
    )[0];
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  let existingRows: (typeof eventGroupEvents.$inferSelect)[];
  let validRows: { id: string }[];
  try {
    // Only inspect the submitted IDs. Reading every group relation here made
    // large groups pay an unnecessary D1 rows-read cost before the atomic plan.
    existingRows = await db
      .select()
      .from(eventGroupEvents)
      .where(
        and(
          eq(eventGroupEvents.event_group_id, groupId),
          inArray(eventGroupEvents.event_id, eventIds),
        ),
      );
    validRows = await db
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.id, eventIds));
  } catch (error) {
    return eventGroupMutationError(error);
  }
  const existingIds = new Set(existingRows.map((row) => row.event_id));
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

  try {
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
    groupId,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }

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

  const groupId = typeof input?.groupId === "string" ? input.groupId.trim() : "";
  const eventId = typeof input?.eventId === "string" ? input.eventId.trim() : "";
  if (!groupId || !eventId) {
    return { ok: false, message: "グループとイベントを指定してください。" };
  }

  const db = guard.db;

  let group: typeof eventGroups.$inferSelect | undefined;
  try {
    group = (
      await db.select().from(eventGroups).where(eq(eventGroups.id, groupId)).limit(1)
    )[0];
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!group) return { ok: false, message: "グループが見つかりません。" };

  let relation: typeof eventGroupEvents.$inferSelect | undefined;
  try {
    relation = (
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
  } catch (error) {
    return eventGroupMutationError(error);
  }
  if (!relation) {
    return { ok: false, message: "イベントはグループに追加されていません。" };
  }

  try {
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
    groupId,
    });
  } catch (error) {
    return eventGroupMutationError(error);
  }

  revalidatePath(`/admin/event-groups/${groupId}/edit`);
  revalidatePath("/event");
  return { ok: true, id: groupId };
}
