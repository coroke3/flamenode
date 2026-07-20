"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { canonicalizePermissionKey } from "@/lib/auth/permissions/aliases";
import { isAdminOnlyKey, type PermissionKey } from "@/lib/auth/permissions/keys";
import { normalizePermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import {
  EVENT_STAFF_PRESETS,
  getPresetPermissions,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";
import { getDatabase } from "@/lib/cloudflare";
import { eventStaff, users, xUsers } from "@/lib/db/schema";
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
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

export interface StaffActionResult {
  ok: boolean;
  message?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;

async function ensureEventManager(eventId: string): Promise<
  | { ok: true; userId: string; role: string | null; db: DB }
  | { ok: false; result: StaffActionResult }
> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  const db = getDatabase();
  if (!db) return { ok: false, result: { ok: false, message: "DB に接続できません。" } };
  try {
    await assertCanEditEvent(db, { id: user.id, role: user.role ?? null }, eventId, "event.members");
  } catch (error) {
    return { ok: false, result: { ok: false, message: error instanceof Error ? error.message : "権限がありません。" } };
  }
  return { ok: true, userId: user.id, role: user.role ?? null, db };
}

function revalidateEventStaffPaths(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/staff`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/admin/events/${eventId}/staff`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
}

function parsePermissionKeys(raw: string | null | undefined): string[] {
  const keys = (raw ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  const invalid = keys.find((key) => !canonicalizePermissionKey(key));
  if (invalid) throw new Error(`不正な権限キーです: ${invalid}`);
  return [...new Set(keys)];
}

function assignmentFromInput(
  preset: EventStaffPreset,
  rawKeys: readonly string[],
  isSiteAdmin: boolean,
): { permission_preset: EventStaffPreset; custom_permission_keys_json: string | null; keys: PermissionKey[] } {
  if (preset === "xid_reviewer" && !isSiteAdmin) {
    throw new Error("X ID確認権限は site admin 専用です。");
  }
  if (preset !== "custom") {
    return { permission_preset: preset, custom_permission_keys_json: null, keys: [...getPresetPermissions(preset)] };
  }
  const keys = normalizePermissionKeys(rawKeys, { allowAdminOnly: isSiteAdmin });
  const denied = rawKeys
    .map(canonicalizePermissionKey)
    .filter((key): key is PermissionKey => !!key && isAdminOnlyKey(key));
  if (!isSiteAdmin && denied.length) throw new Error("site admin 専用権限は付与できません。");
  return {
    permission_preset: keys.length ? "custom" : "public_staff",
    custom_permission_keys_json: keys.length ? JSON.stringify(keys) : null,
    keys,
  };
}

async function findStaffBySubject(
  db: DB,
  eventId: string,
  xUserId: string | null,
  userId: string | null,
): Promise<typeof eventStaff.$inferSelect | null> {
  const subject = xUserId && userId
    ? or(eq(eventStaff.x_user_id, xUserId), eq(eventStaff.user_id, userId))!
    : xUserId
      ? eq(eventStaff.x_user_id, xUserId)
      : userId
        ? eq(eventStaff.user_id, userId)
        : null;
  if (!subject) return null;
  return (await db.select().from(eventStaff).where(and(eq(eventStaff.event_id, eventId), subject)!).limit(1))[0] ?? null;
}

async function findStaffById(db: DB, eventId: string, staffId: string) {
  return (await db.select().from(eventStaff).where(and(eq(eventStaff.event_id, eventId), eq(eventStaff.id, staffId))!).limit(1))[0] ?? null;
}

/** 未登録 X ID の作成とその監査を event_staff mutation と同じ D1 batch に含める。 */
async function prepareXUserExtras(args: {
  db: DB;
  xUserId: string | null;
  displayName: string;
  actorUserId: string;
  now: number;
  context: string;
}): Promise<EventStaffAtomicExtras | undefined> {
  if (!args.xUserId) return undefined;
  const existing = await args.db.select().from(xUsers).where(eq(xUsers.id, args.xUserId)).get();
  if (existing) return undefined;
  const after = {
    id: args.xUserId,
    x_name: args.displayName || `@${args.xUserId}`,
    approval_status: "pending" as const,
  };
  return {
    mutationStatements: [
      args.db.insert(xUsers).values(after),
    ],
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
  x_user_id: z.string().trim().regex(/^[A-Za-z0-9_]{1,32}$/).optional().nullable(),
  user_id: z.string().trim().min(1).optional().nullable(),
  permission_preset: z.enum(EVENT_STAFF_PRESETS).default("public_staff"),
  permission_keys: z.string().trim().optional().nullable(),
  is_public: z.coerce.number().min(0).max(1).default(0),
  public_role_label: z.string().trim().max(40).optional().nullable(),
  internal_note: z.string().trim().max(500).optional().nullable(),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional().nullable(),
});

export async function upsertEventStaffMember(formData: FormData): Promise<StaffActionResult> {
  const raw = Object.fromEntries(formData);
  for (const key of ["x_user_id", "user_id", "staff_id", "public_role_label", "internal_note", "confirm_text"] as const) {
    if (typeof raw[key] === "string" && raw[key].trim() === "") raw[key] = null as never;
  }
  const parsed = staffMemberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const data = parsed.data;
  const xUserId = data.x_user_id ? normalizeXId(data.x_user_id) : null;
  const userId = data.user_id?.trim() || null;
  if (!xUserId && !userId) return { ok: false, message: "内部ユーザー ID または X ID が必要です。" };

  const guard = await ensureEventManager(data.event_id);
  if (!guard.ok) return guard.result;
  let permissionKeys: string[];
  let assignment;
  try {
    permissionKeys = parsePermissionKeys(data.permission_keys);
    assignment = assignmentFromInput(data.permission_preset, permissionKeys, guard.role === "admin");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "入力エラー" };
  }

  const existing = data.staff_id
    ? await findStaffById(guard.db, data.event_id, data.staff_id)
    : await findStaffBySubject(guard.db, data.event_id, xUserId, userId);
  if (assignment.permission_preset === "owner" && existing?.permission_preset !== "owner") {
    try {
      await assertActorMayAssignOwner({
        db: guard.db,
        eventId: data.event_id,
        actorUserId: guard.userId,
        isSiteAdmin: guard.role === "admin",
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "owner を付与できません。" };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const atomicExtras = await prepareXUserExtras({
    db: guard.db,
    xUserId,
    displayName: data.display_name,
    actorUserId: guard.userId,
    now,
    context: "event-staff-admin",
  });
  try {
    if (existing) {
      await updateEventStaffWithProtection({
        db: guard.db,
        existing,
        values: {
          user_id: userId ?? existing.user_id,
          x_user_id: xUserId ?? existing.x_user_id,
          display_name: data.display_name,
          permission_preset: assignment.permission_preset,
          custom_permission_keys_json: assignment.custom_permission_keys_json,
          is_public: data.is_public,
          public_role_label: data.public_role_label ?? null,
          internal_note: data.internal_note ?? existing.internal_note,
        },
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
        values: {
          user_id: userId,
          x_user_id: xUserId,
          display_name: data.display_name,
          permission_preset: assignment.permission_preset,
          custom_permission_keys_json: assignment.custom_permission_keys_json,
          is_public: data.is_public,
          public_role_label: data.public_role_label ?? null,
          internal_note: data.internal_note ?? null,
        },
        actorUserId: guard.userId,
        reason: data.reason,
        context: "event-staff-admin",
        now,
        atomicExtras,
      });
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "スタッフを保存できません。" };
  }
  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}

const csvImportRowSchema = z.object({
  lineNumber: z.number().int().positive(),
  display_name: z.string().trim().min(1).max(80),
  x_user_id: z.string().trim().max(64),
  user_id: z.string().trim().max(255),
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

/**
 * 正本CSVの全行を一つの D1 batch で保存する。CSVには確認文言を持たせないため、
 * 代表者と自分自身の権限変更は個別画面・代表者移譲画面に限定する。
 */
export async function bulkUpsertEventStaffFromCsv(
  input: unknown,
): Promise<StaffActionResult> {
  const parsed = csvImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "CSV入力エラーです。",
    };
  }
  const data = parsed.data;
  const guard = await ensureEventManager(data.eventId);
  if (!guard.ok) return guard.result;

  const normalizedRows: Array<{
    lineNumber: number;
    displayName: string;
    xUserId: string | null;
    userId: string | null;
    assignment: ReturnType<typeof assignmentFromInput>;
    isPublic: number;
    publicRoleLabel: string | null;
  }> = [];
  try {
    for (const row of data.rows) {
      const xUserId = row.x_user_id ? normalizeXId(row.x_user_id) : null;
      const userId = row.user_id || null;
      if (!xUserId && !userId) {
        throw new Error(`${row.lineNumber}行目: 内部ユーザー ID または X ID が必要です。`);
      }
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
        xUserId,
        userId,
        assignment,
        isPublic: Number(row.is_public_staff),
        publicRoleLabel: row.public_role_label || null,
      });
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "CSV入力エラーです。",
    };
  }

  const requestedXIds = Array.from(
    new Set(normalizedRows.flatMap((row) => (row.xUserId ? [row.xUserId] : []))),
  );
  const requestedUserIds = Array.from(
    new Set(normalizedRows.flatMap((row) => (row.userId ? [row.userId] : []))),
  );
  const [existingStaffRows, knownXRows, knownUserRows] = await Promise.all([
    guard.db
      .select()
      .from(eventStaff)
      .where(eq(eventStaff.event_id, data.eventId)),
    requestedXIds.length > 0
      ? guard.db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(inArray(xUsers.id, requestedXIds))
      : Promise.resolve([]),
    requestedUserIds.length > 0
      ? guard.db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, requestedUserIds))
      : Promise.resolve([]),
  ]);
  const knownUserIds = new Set(knownUserRows.map((row) => row.id));
  const missingUserId = requestedUserIds.find((id) => !knownUserIds.has(id));
  if (missingUserId) {
    return {
      ok: false,
      message: `指定された内部ユーザー ID が見つかりません: ${missingUserId}`,
    };
  }

  const existingByX = new Map(
    existingStaffRows.flatMap((row) => (row.x_user_id ? [[row.x_user_id, row] as const] : [])),
  );
  const existingByUser = new Map(
    existingStaffRows.flatMap((row) => (row.user_id ? [[row.user_id, row] as const] : [])),
  );
  const upserts: EventStaffBulkUpsert[] = [];
  try {
    for (const row of normalizedRows) {
      const byX = row.xUserId ? existingByX.get(row.xUserId) ?? null : null;
      const byUser = row.userId ? existingByUser.get(row.userId) ?? null : null;
      if (byX && byUser && byX.id !== byUser.id) {
        throw new Error(
          `${row.lineNumber}行目: X ID と内部ユーザー ID が別々の既存スタッフを指しています。`,
        );
      }
      const existing = byX ?? byUser;
      if (existing?.permission_preset === "owner") {
        throw new Error(
          `${row.lineNumber}行目: 代表者はCSVで変更できません。専用の代表者移譲操作を使用してください。`,
        );
      }
      upserts.push({
        id: existing?.id ?? generateId("es"),
        existingId: existing?.id ?? null,
        values: {
          user_id: row.userId ?? existing?.user_id ?? null,
          x_user_id: row.xUserId ?? existing?.x_user_id ?? null,
          display_name: row.displayName,
          permission_preset: row.assignment.permission_preset,
          custom_permission_keys_json: row.assignment.custom_permission_keys_json,
          is_public: row.isPublic,
          public_role_label: row.publicRoleLabel,
          internal_note: existing?.internal_note ?? null,
        },
      });
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "CSVのスタッフ対応付けに失敗しました。",
    };
  }

  const knownXIds = new Set(knownXRows.map((row) => row.id));
  const now = Math.floor(Date.now() / 1000);
  const pendingXIds = new Set<string>();
  const newXRows = normalizedRows
    .filter((row) => {
      const xUserId = row.xUserId;
      if (!xUserId || knownXIds.has(xUserId) || pendingXIds.has(xUserId)) {
        return false;
      }
      pendingXIds.add(xUserId);
      return true;
    })
    .map((row) => ({
      id: row.xUserId!,
      x_name: row.displayName || `@${row.xUserId}`,
      icon_url: null,
      profile_text: null,
      portfolio_contact: null,
      youtube_channel_url: null,
      other_social_links: null,
      creative_start_date: null,
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

  try {
    await bulkUpsertEventStaffWithProtection({
      db: guard.db,
      eventId: data.eventId,
      actorUserId: guard.userId,
      reason: data.reason,
      context,
      now,
      upserts,
      atomicExtras: {
        mutationStatements: newXRows.map((row) => guard.db.insert(xUsers).values(row)),
        expectedMutationChanges: newXRows.map(() => 1),
        audits: xUserAudits,
      },
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "CSV保存に失敗しました。",
    };
  }

  revalidateEventStaffPaths(data.eventId);
  return { ok: true };
}

const removeSchema = z.object({
  event_id: z.string().trim().min(1),
  staff_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional().nullable(),
});

export async function removeEventStaffMember(formData: FormData): Promise<StaffActionResult> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const data = parsed.data;
  const guard = await ensureEventManager(data.event_id);
  if (!guard.ok) return guard.result;
  const existing = await findStaffById(guard.db, data.event_id, data.staff_id);
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
    return { ok: false, message: error instanceof Error ? error.message : "スタッフを削除できません。" };
  }
  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}

const transferSchema = z.object({
  event_id: z.string().trim().min(1),
  from_staff_id: z.string().trim().min(1),
  to_staff_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().min(1),
  self_confirm_text: z.string().trim().optional().nullable(),
});

export async function transferEventOwnershipAction(formData: FormData): Promise<StaffActionResult> {
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
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
    return { ok: false, message: error instanceof Error ? error.message : "代表者を移譲できません。" };
  }
  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}
