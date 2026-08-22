"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { canonicalizePermissionKey } from "@/lib/auth/permissions/aliases";
import {
  isAdminOnlyKey,
  type PermissionKey,
} from "@/lib/auth/permissions/keys";
import { normalizePermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import {
  EVENT_STAFF_PRESETS,
  getPresetPermissions,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";
import type { DB } from "@/lib/db/client";
import { eventStaff, xUsers } from "@/lib/db/schema";
import {
  assertActorMayAssignOwner,
  bulkUpsertEventStaffWithProtection,
  createEventStaffWithProtection,
  deleteEventStaffWithProtection,
  transferEventOwnership,
  updateEventStaffWithProtection,
  type EventStaffAtomicExtras,
  type EventStaffBulkUpsert,
} from "@/lib/event/eventOwnership";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { generateId } from "@/lib/utils/id";
import { parseCanonicalXId } from "@/lib/utils/xid";
import { planD1AuditMutationBudget } from "@/lib/audit/mutateBudget";
import { enqueueStaticRebuildMany } from "@/lib/staticRebuild/enqueue";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";

export interface StaffActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}

function staffPreparationError(error: unknown): StaffActionResult {
  unstable_rethrow(error);
  console.error("[event-staff] preparation read failed", error);
  return {
    ok: false,
    message: "スタッフ情報の取得に失敗しました。再読み込みして、もう一度お試しください。",
  };
}

async function ensureEventManager(eventId: string): Promise<
  | { ok: true; userId: string; role: string | null; db: DB }
  | { ok: false; result: StaffActionResult }
> {
  const identity = await writeGuard({ feature: "manage_event_staff" });
  if (!identity.ok) {
    return {
      ok: false,
      result: { ok: false, message: identity.message },
    };
  }
  const { db, user } = identity;
  try {
    await assertCanEditEvent(
      db,
      { id: user.id, role: user.role },
      eventId,
      "event.members",
    );
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      result: {
        ok: false,
        message: error instanceof Error ? error.message : "権限がありません。",
      },
    };
  }
  return { ok: true, userId: user.id, role: user.role, db };
}

function revalidateEventStaffPaths(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/staff`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/admin/events/${eventId}/staff`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
}

async function revalidateEventStaffPathsBestEffort(args: {
  db: DB;
  eventId: string;
  actorUserId: string;
  reason: string;
}): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "event_staff", traceId: createTraceId() },
    [
      {
        name: "revalidate_event_staff_paths",
        run: async () => {
          revalidateEventStaffPaths(args.eventId);
        },
      },
      {
        name: "enqueue_event_static_rebuild",
        run: async () => {
          await enqueueStaticRebuildMany(
            args.db,
            [
              {
                targetType: "event_base",
                targetId: args.eventId,
                reason: args.reason,
                priority: "high",
                requestedByUserId: args.actorUserId,
              },
              {
                targetType: "event_slots",
                targetId: args.eventId,
                reason: args.reason,
                priority: "high",
                requestedByUserId: args.actorUserId,
              },
              {
                targetType: "events_index",
                targetId: "global",
                reason: args.reason,
                priority: "low",
                requestedByUserId: args.actorUserId,
              },
              // スタッフ登録でpending x_usersを作り得るため候補indexも更新する。
              {
                targetType: "member_suggestions",
                targetId: "global",
                reason: args.reason,
                priority: "low",
              },
            ],
            { wakeSource: "web" },
          );
        },
      },
    ],
  );
}

function parsePermissionKeys(raw: string | null | undefined): string[] {
  const keys = (raw ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const invalid = keys.find((key) => !canonicalizePermissionKey(key));
  if (invalid) throw new Error(`不正な権限キーです: ${invalid}`);
  return [...new Set(keys)];
}

function assignmentFromInput(
  preset: EventStaffPreset,
  rawKeys: readonly string[],
  isSiteAdmin: boolean,
): {
  permission_preset: EventStaffPreset;
  custom_permission_keys_json: string | null;
  keys: PermissionKey[];
} {
  if (preset === "xid_reviewer" && !isSiteAdmin) {
    throw new Error("X ID確認権限は site admin 専用です。");
  }
  if (preset !== "custom") {
    return {
      permission_preset: preset,
      custom_permission_keys_json: null,
      keys: [...getPresetPermissions(preset)],
    };
  }
  const keys = normalizePermissionKeys(rawKeys, { allowAdminOnly: isSiteAdmin });
  const denied = rawKeys
    .map(canonicalizePermissionKey)
    .filter((key): key is PermissionKey => !!key && isAdminOnlyKey(key));
  if (!isSiteAdmin && denied.length) {
    throw new Error("site admin 専用権限は付与できません。");
  }
  return {
    permission_preset: keys.length ? "custom" : "public_staff",
    custom_permission_keys_json: keys.length ? JSON.stringify(keys) : null,
    keys,
  };
}

async function findStaffByXUserId(
  db: DB,
  eventId: string,
  xUserId: string,
): Promise<typeof eventStaff.$inferSelect | null> {
  const exact = (
    await db
      .select()
      .from(eventStaff)
      .where(
        and(
          eq(eventStaff.event_id, eventId),
          eq(eventStaff.x_user_id, xUserId),
        )!,
      )
      .limit(1)
  )[0];
  if (exact) return exact;

  // Legacy/imported rows may retain @-prefixed or mixed-case IDs. Keep the
  // canonical fast path above, and only scan this event when it misses so a
  // new canonical write cannot create a duplicate logical staff subject.
  const legacyCandidates = await db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, eventId));
  const matches = legacyCandidates.filter(
    (row) => parseCanonicalXId(row.x_user_id) === xUserId,
  );
  if (matches.length > 1) {
    throw new Error("同じX IDを指す既存スタッフ行が複数あるため、先に整理してください。");
  }
  return matches[0] ?? null;
}

async function findStaffById(db: DB, eventId: string, staffId: string) {
  return (
    await db
      .select()
      .from(eventStaff)
      .where(
        and(eq(eventStaff.event_id, eventId), eq(eventStaff.id, staffId))!,
      )
      .limit(1)
  )[0] ?? null;
}

async function prepareXUserExtras(args: {
  db: DB;
  xUserId: string;
  displayName: string;
  actorUserId: string;
  context: string;
}): Promise<EventStaffAtomicExtras | undefined> {
  const existing = await args.db
    .select({ id: xUsers.id })
    .from(xUsers)
    .where(eq(xUsers.id, args.xUserId))
    .get();
  if (existing) return undefined;
  const after = {
    id: args.xUserId,
    x_name: args.displayName || `@${args.xUserId}`,
    approval_status: "pending" as const,
  };
  return {
    mutationStatements: [args.db.insert(xUsers).values(after)],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_users",
        target_id: args.xUserId,
        operation: "CREATE",
        before: null,
        after,
        actor_user_id: args.actorUserId,
        reason: "イベントスタッフ登録に伴う X ID 作成",
        context: args.context,
        retention_class: "long_audit",
        restore_strategy: "delete_created",
        strict: true,
      },
    ],
  };
}

const staffMemberSchema = z.object({
  event_id: z.string().trim().min(1),
  staff_id: z.string().trim().optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  x_user_id: z.string().trim().refine(
    (value) => parseCanonicalXId(value) !== null,
    "X IDは英数字/アンダースコア20文字以内で入力してください",
  ),
  permission_preset: z.enum(EVENT_STAFF_PRESETS).default("public_staff"),
  permission_keys: z.string().trim().optional().nullable(),
  is_public: z.coerce.number().int().min(0).max(1).default(0),
  public_role_label: z.string().trim().max(40).optional().nullable(),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional().nullable(),
});

export async function upsertEventStaffMember(
  formData: FormData,
): Promise<StaffActionResult> {
  const raw = Object.fromEntries(formData);
  for (const key of ["staff_id", "public_role_label", "confirm_text"] as const) {
    if (typeof raw[key] === "string" && raw[key].trim() === "") {
      raw[key] = null as never;
    }
  }
  const parsed = staffMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const xUserId = parseCanonicalXId(data.x_user_id);
  if (!xUserId) return { ok: false, message: "X IDが不正です" };
  const guard = await ensureEventManager(data.event_id);
  if (!guard.ok) return guard.result;

  let assignment: ReturnType<typeof assignmentFromInput>;
  try {
    assignment = assignmentFromInput(
      data.permission_preset,
      parsePermissionKeys(data.permission_keys),
      guard.role === "admin",
    );
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "入力エラー",
    };
  }

  let existing: typeof eventStaff.$inferSelect | null;
  let atomicExtras: EventStaffAtomicExtras | undefined;
  try {
    existing = data.staff_id
      ? await findStaffById(guard.db, data.event_id, data.staff_id)
      : await findStaffByXUserId(guard.db, data.event_id, xUserId);
    atomicExtras = await prepareXUserExtras({
      db: guard.db,
      xUserId,
      displayName: data.display_name,
      actorUserId: guard.userId,
      context: "event-staff-admin",
    });
  } catch (error) {
    return staffPreparationError(error);
  }
  if (
    assignment.permission_preset === "owner" &&
    existing?.permission_preset !== "owner"
  ) {
    try {
      await assertActorMayAssignOwner({
        db: guard.db,
        eventId: data.event_id,
        actorUserId: guard.userId,
        isSiteAdmin: guard.role === "admin",
      });
    } catch (error) {
      unstable_rethrow(error);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "owner を付与できません。",
      };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const values = {
    x_user_id: xUserId,
    display_name: data.display_name,
    permission_preset: assignment.permission_preset,
    custom_permission_keys_json: assignment.custom_permission_keys_json,
    is_public: data.is_public,
    public_role_label: data.public_role_label ?? null,
  };

  try {
    if (existing) {
      await updateEventStaffWithProtection({
        db: guard.db,
        existing,
        values,
        actorUserId: guard.userId,
        reason: data.reason,
        confirmText: data.confirm_text,
        context: "event-staff-admin",
        now,
        atomicExtras,
      });
    } else {
      await createEventStaffWithProtection({
        db: guard.db,
        id: generateId("es"),
        eventId: data.event_id,
        values,
        actorUserId: guard.userId,
        reason: data.reason,
        context: "event-staff-admin",
        now,
        atomicExtras,
      });
    }
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "スタッフを保存できません。",
    };
  }
  await revalidateEventStaffPathsBestEffort({
    db: guard.db,
    eventId: data.event_id,
    actorUserId: guard.userId,
    reason: data.reason,
  });
  return markPendingPublicReflection({ ok: true }, true);
}

const csvImportRowSchema = z.object({
  lineNumber: z.number().int().positive(),
  display_name: z.string().trim().min(1).max(80),
  x_user_id: z.string().trim().min(1).max(64),
  permission_preset: z.enum(EVENT_STAFF_PRESETS),
  permission_keys: z.array(z.string().trim().min(1).max(100)).max(64),
  is_public_staff: z.enum(["0", "1"]),
  public_role_label: z.string().trim().max(40),
});

const csvImportSchema = z.object({
  eventId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  rows: z.array(csvImportRowSchema).min(1).max(100),
});

function csvValidationMessage(input: unknown, error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  if (path[0] === "rows" && typeof path[1] === "number") {
    const rows =
      input && typeof input === "object"
        ? (input as { rows?: unknown }).rows
        : null;
    const rawRow = Array.isArray(rows) ? rows[path[1]] : null;
    const lineNumber =
      rawRow &&
      typeof rawRow === "object" &&
      typeof (rawRow as { lineNumber?: unknown }).lineNumber === "number"
        ? (rawRow as { lineNumber: number }).lineNumber
        : path[1] + 1;
    if (path[2] === "x_user_id") {
      return `${lineNumber}行目: X IDが不正です`;
    }
  }
  return issue?.message ?? "CSVの入力内容を確認してください。";
}

export async function bulkUpsertEventStaffFromCsv(
  input: unknown,
): Promise<StaffActionResult> {
  const parsed = csvImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: csvValidationMessage(input, parsed.error),
    };
  }
  const data = parsed.data;
  const guard = await ensureEventManager(data.eventId);
  if (!guard.ok) return guard.result;

  const normalizedRows: Array<{
    lineNumber: number;
    displayName: string;
    xUserId: string;
    assignment: ReturnType<typeof assignmentFromInput>;
    isPublic: number;
    publicRoleLabel: string | null;
  }> = [];
  try {
    for (const row of data.rows) {
      const assignment = assignmentFromInput(
        row.permission_preset,
        row.permission_keys,
        guard.role === "admin",
      );
      if (assignment.permission_preset === "owner") {
        throw new Error(
          `${row.lineNumber}行目: 代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。`,
        );
      }
      normalizedRows.push({
        lineNumber: row.lineNumber,
        displayName: row.display_name,
        xUserId: (() => {
          const parsed = parseCanonicalXId(row.x_user_id);
          if (!parsed) {
            throw new Error(`${row.lineNumber}行目: X IDが不正です`);
          }
          return parsed;
        })(),
        assignment,
        isPublic: Number(row.is_public_staff),
        publicRoleLabel: row.public_role_label || null,
      });
    }
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "CSV入力エラーです。",
    };
  }

  const requestedXIds = Array.from(
    new Set(normalizedRows.map((row) => row.xUserId)),
  );
  let existingStaffRows: (typeof eventStaff.$inferSelect)[];
  let knownXRows: Array<{ id: string }>;
  try {
    [existingStaffRows, knownXRows] = await Promise.all([
      guard.db
        .select()
        .from(eventStaff)
        .where(eq(eventStaff.event_id, data.eventId)),
      guard.db
        .select({ id: xUsers.id })
        .from(xUsers)
        .where(inArray(xUsers.id, requestedXIds)),
    ]);
  } catch (error) {
    return staffPreparationError(error);
  }
  const requestedXIdSet = new Set(requestedXIds);
  const existingByX = new Map<string, (typeof eventStaff.$inferSelect) | null>();
  for (const row of existingStaffRows) {
    const normalized = parseCanonicalXId(row.x_user_id);
    if (!normalized || !requestedXIdSet.has(normalized)) continue;
    if (existingByX.has(normalized)) {
      return {
        ok: false,
        message: "同じX IDを指す既存スタッフ行が複数あるため、先に整理してください。",
      };
    }
    existingByX.set(normalized, row);
  }
  const upserts: EventStaffBulkUpsert[] = [];
  const seenCsvXIds = new Map<string, number>();
  for (const row of normalizedRows) {
    const previousLine = seenCsvXIds.get(row.xUserId);
    if (previousLine !== undefined) {
      return {
        ok: false,
        message: `${row.lineNumber}行目: X IDは${previousLine}行目と重複しています`,
      };
    }
    seenCsvXIds.set(row.xUserId, row.lineNumber);
    const existing = existingByX.get(row.xUserId) ?? null;
    if (existing?.permission_preset === "owner") {
      return {
        ok: false,
        message: `${row.lineNumber}行目: 代表者はCSVで変更できません。専用の代表者移譲操作を使用してください。`,
      };
    }
    upserts.push({
      id: existing?.id ?? generateId("es"),
      existingId: existing?.id ?? null,
      values: {
        x_user_id: row.xUserId,
        display_name: row.displayName,
        permission_preset: row.assignment.permission_preset,
        custom_permission_keys_json:
          row.assignment.custom_permission_keys_json,
        is_public: row.isPublic,
        public_role_label: row.publicRoleLabel,
      },
    });
  }

  const knownXIds = new Set(knownXRows.map((row) => row.id));
  const newXRows = normalizedRows
    .filter((row, index, rows) =>
      !knownXIds.has(row.xUserId) &&
      rows.findIndex((candidate) => candidate.xUserId === row.xUserId) === index,
    )
    .map((row) => ({
      id: row.xUserId,
      x_name: row.displayName || `@${row.xUserId}`,
      approval_status: "pending" as const,
    }));
  const context = `event-staff-csv:${generateId("batch")}`;
  const xUserAudits = newXRows.map<WriteAuditLogInput>((row) => ({
    table_name: "x_users",
    target_id: row.id,
    operation: "CREATE",
    before: null,
    after: row,
    actor_user_id: guard.userId,
    reason: data.reason,
    context,
    retention_class: "long_audit",
    restore_strategy: "delete_created",
    strict: true,
  }));

  const budget = planD1AuditMutationBudget({
    mutationStatementCount: upserts.length + newXRows.length,
    mutationAssertionCount: upserts.length + newXRows.length,
    auditEntryCount: upserts.length + newXRows.length,
    distinctActorCount: 1,
  });
  if (!budget.withinLimit) {
    return {
      ok: false,
      message: `このCSVは1回の原子更新上限を超えています（${budget.totalQueryCount}/${budget.limit} query）。件数を分けて登録してください`,
    };
  }

  try {
    await bulkUpsertEventStaffWithProtection({
      db: guard.db,
      eventId: data.eventId,
      actorUserId: guard.userId,
      reason: data.reason,
      context,
      now: Math.floor(Date.now() / 1000),
      upserts,
      atomicExtras: {
        mutationStatements: newXRows.map((row) =>
          guard.db.insert(xUsers).values(row),
        ),
        expectedMutationChanges: newXRows.map(() => 1),
        audits: xUserAudits,
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "CSV保存に失敗しました。",
    };
  }
  await revalidateEventStaffPathsBestEffort({
    db: guard.db,
    eventId: data.eventId,
    actorUserId: guard.userId,
    reason: data.reason,
  });
  return markPendingPublicReflection({ ok: true }, true);
}

const removeSchema = z.object({
  event_id: z.string().trim().min(1),
  staff_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional().nullable(),
});

export async function removeEventStaffMember(
  formData: FormData,
): Promise<StaffActionResult> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const guard = await ensureEventManager(data.event_id);
  if (!guard.ok) return guard.result;
  let existing: typeof eventStaff.$inferSelect | null;
  try {
    existing = await findStaffById(guard.db, data.event_id, data.staff_id);
  } catch (error) {
    return staffPreparationError(error);
  }
  if (!existing) return { ok: true };
  try {
    await deleteEventStaffWithProtection({
      db: guard.db,
      existing,
      actorUserId: guard.userId,
      reason: data.reason,
      confirmText: data.confirm_text,
      context: "event-staff-admin",
    });
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "スタッフを削除できません。",
    };
  }
  await revalidateEventStaffPathsBestEffort({
    db: guard.db,
    eventId: data.event_id,
    actorUserId: guard.userId,
    reason: data.reason,
  });
  return markPendingPublicReflection({ ok: true }, true);
}

const transferSchema = z.object({
  event_id: z.string().trim().min(1),
  from_staff_id: z.string().trim().min(1),
  to_staff_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().min(1),
  self_confirm_text: z.string().trim().optional().nullable(),
});

export async function transferEventOwnershipAction(
  formData: FormData,
): Promise<StaffActionResult> {
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  const guard = await ensureEventManager(data.event_id);
  if (!guard.ok) return guard.result;
  try {
    await assertActorMayAssignOwner({
      db: guard.db,
      eventId: data.event_id,
      actorUserId: guard.userId,
      isSiteAdmin: guard.role === "admin",
    });
    await transferEventOwnership({
      db: guard.db,
      eventId: data.event_id,
      fromStaffId: data.from_staff_id,
      toStaffId: data.to_staff_id,
      actorUserId: guard.userId,
      reason: data.reason,
      confirmText: data.confirm_text,
      selfConfirmText: data.self_confirm_text,
    });
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "代表者を移譲できません。",
    };
  }
  await revalidateEventStaffPathsBestEffort({
    db: guard.db,
    eventId: data.event_id,
    actorUserId: guard.userId,
    reason: data.reason,
  });
  return markPendingPublicReflection({ ok: true }, true);
}
