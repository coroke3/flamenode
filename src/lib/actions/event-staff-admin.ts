"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import {
  eventStaff,
  eventStaffPermissions,
  historyLogs,
  xUsers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  COLLABORATOR_PERMISSION_KEYS,
  type CollaboratorPermissionKey,
} from "@/lib/constants/collaborator-permissions";
import { normalizeXId } from "@/lib/utils/xid";

export interface StaffActionResult {
  ok: boolean;
  message?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type StaffRole = "editor" | "representative" | "staff";

const allPermissionKeys = [...COLLABORATOR_PERMISSION_KEYS];

async function ensureAdminFor(eventId: string): Promise<
  | { ok: true; userId: string; db: DB }
  | { ok: false; result: StaffActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) {
    return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  }
  const db = getDatabase();
  if (!db) {
    return { ok: false, result: { ok: false, message: "DB に接続できません。" } };
  }
  try {
    await assertCanEditEvent(
      db,
      { id: u.id, role: u.role ?? null },
      eventId,
      "event.members",
    );
  } catch (e) {
    return {
      ok: false,
      result: {
        ok: false,
        message: e instanceof Error ? e.message : "権限がありません。",
      },
    };
  }
  return { ok: true, userId: u.id, db };
}

function revalidateEventStaffPaths(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/staff`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/manage`);
  revalidatePath(`/admin/events/${eventId}/staff`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
}

async function ensureXUser(
  db: DB,
  xUserId: string,
  displayName: string,
  now: number,
): Promise<string> {
  const existing = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (existing) return existing.x_name ?? `@${xUserId}`;
  await db.insert(xUsers).values({
    id: xUserId,
    x_name: displayName || `@${xUserId}`,
    approval_status: "pending",
    approval_requested_at: now,
  });
  return displayName || `@${xUserId}`;
}

async function findStaffBySubject(
  db: DB,
  eventId: string,
  xUserId: string | null,
  discordUserId: string | null,
): Promise<typeof eventStaff.$inferSelect | null> {
  const subject =
    xUserId && discordUserId
      ? or(
          eq(eventStaff.x_user_id, xUserId),
          eq(eventStaff.discord_user_id, discordUserId),
        )!
      : xUserId
        ? eq(eventStaff.x_user_id, xUserId)
        : discordUserId
          ? eq(eventStaff.discord_user_id, discordUserId)
          : null;
  if (!subject) return null;
  return (
    await db
      .select()
      .from(eventStaff)
      .where(and(eq(eventStaff.event_id, eventId), subject)!)
      .limit(1)
  )[0] ?? null;
}

async function replacePermissions(
  db: DB,
  staffId: string,
  keys: readonly CollaboratorPermissionKey[],
  now: number,
): Promise<void> {
  await db
    .delete(eventStaffPermissions)
    .where(eq(eventStaffPermissions.event_staff_id, staffId));
  const uniqueKeys = Array.from(new Set(keys));
  for (const key of uniqueKeys) {
    await db.insert(eventStaffPermissions).values({
      id: generateId("esp"),
      event_staff_id: staffId,
      permission_key: key,
      allowed: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

function parsePermissionKeys(raw: string | null | undefined): CollaboratorPermissionKey[] {
  const keys = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as CollaboratorPermissionKey[];
  const invalid = keys.find((k) => !COLLABORATOR_PERMISSION_KEYS.includes(k));
  if (invalid) throw new Error(`選べない権限が含まれています: ${invalid}`);
  return Array.from(new Set(keys));
}

async function writeStaffLog(args: {
  db: DB;
  table: "event_staff" | "event_staff_permissions";
  recordId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  userId: string;
  payload?: unknown;
  now: number;
}): Promise<void> {
  await args.db.insert(historyLogs).values({
    table_name: args.table,
    record_id: args.recordId,
    action: args.action,
    after_data: args.payload ? JSON.stringify(args.payload) : null,
    operator_discord_id: args.userId,
    retention_class: "long_audit",
    created_at: args.now,
  });
}

const addEditorSchema = z.object({
  event_id: z.string().trim().min(1),
  x_user_id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9_]{1,32}$/),
  role: z.enum(["editor", "representative"]).default("editor"),
  is_public: z.coerce.number().min(0).max(1).default(1),
  public_role_label: z.string().trim().max(40).optional().nullable(),
  internal_note: z.string().trim().max(500).optional().nullable(),
});

export async function addEventEditor(
  formData: FormData,
): Promise<StaffActionResult> {
  const parsed = addEditorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  const xUserId = normalizeXId(data.x_user_id);
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const now = Math.floor(Date.now() / 1000);

  const existing = await findStaffBySubject(guard.db, data.event_id, xUserId, null);
  if (existing) return { ok: false, message: "既に登録されています。" };

  const displayName = await ensureXUser(guard.db, xUserId, `@${xUserId}`, now);
  const staffId = generateId("es");
  await guard.db.insert(eventStaff).values({
    id: staffId,
    event_id: data.event_id,
    x_user_id: xUserId,
    discord_user_id: null,
    display_name: displayName,
    role: data.role,
    is_public: data.is_public,
    public_role_label: data.public_role_label ?? null,
    internal_note: data.internal_note ?? null,
    approved_by_user_id: guard.userId,
    approved_at: now,
    created_at: now,
    updated_at: now,
  });
  await replacePermissions(guard.db, staffId, allPermissionKeys, now);
  await writeStaffLog({
    db: guard.db,
    table: "event_staff",
    recordId: staffId,
    action: "CREATE",
    userId: guard.userId,
    payload: { event_id: data.event_id, x_user_id: xUserId, role: data.role },
    now,
  });

  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}

export async function removeEventEditor(
  formData: FormData,
): Promise<StaffActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!eventId || !xUserId) {
    return { ok: false, message: "event_id と x_user_id が必要です。" };
  }
  const guard = await ensureAdminFor(eventId);
  if (!guard.ok) return guard.result;
  const existing = await findStaffBySubject(guard.db, eventId, xUserId, null);
  if (!existing) return { ok: true };
  const now = Math.floor(Date.now() / 1000);

  await guard.db
    .delete(eventStaffPermissions)
    .where(eq(eventStaffPermissions.event_staff_id, existing.id));
  await guard.db.delete(eventStaff).where(eq(eventStaff.id, existing.id));
  await writeStaffLog({
    db: guard.db,
    table: "event_staff",
    recordId: existing.id,
    action: "DELETE",
    userId: guard.userId,
    now,
  });

  revalidateEventStaffPaths(eventId);
  return { ok: true };
}

const updateEditorSchema = addEditorSchema.extend({});

export async function updateEventEditor(
  formData: FormData,
): Promise<StaffActionResult> {
  const parsed = updateEditorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  const xUserId = normalizeXId(data.x_user_id);
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const existing = await findStaffBySubject(guard.db, data.event_id, xUserId, null);
  if (!existing) return { ok: false, message: "対象スタッフが見つかりません。" };
  const now = Math.floor(Date.now() / 1000);

  await guard.db
    .update(eventStaff)
    .set({
      role: data.role,
      is_public: data.is_public,
      public_role_label: data.public_role_label ?? null,
      internal_note: data.internal_note ?? null,
      updated_at: now,
    })
    .where(eq(eventStaff.id, existing.id));
  await writeStaffLog({
    db: guard.db,
    table: "event_staff",
    recordId: existing.id,
    action: "UPDATE",
    userId: guard.userId,
    payload: { role: data.role, is_public: data.is_public },
    now,
  });

  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}

const collabSchema = z.object({
  event_id: z.string().trim().min(1),
  x_user_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,32}$/)
    .optional()
    .nullable(),
  discord_user_id: z.string().trim().min(1).optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  permission_keys: z.string().trim().optional().nullable(),
  is_public_staff: z.coerce.number().min(0).max(1).default(0),
  public_role_label: z.string().trim().max(40).optional().nullable(),
});

export async function upsertCollaborator(
  formData: FormData,
): Promise<StaffActionResult> {
  const raw = Object.fromEntries(formData);
  if (typeof raw.x_user_id === "string" && raw.x_user_id.trim() === "") raw.x_user_id = null as never;
  if (typeof raw.discord_user_id === "string" && raw.discord_user_id.trim() === "") raw.discord_user_id = null as never;
  const parsed = collabSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const data = parsed.data;
  const xUserId = data.x_user_id ? normalizeXId(data.x_user_id) : null;
  const discordUserId = data.discord_user_id?.trim() || null;
  if (!xUserId && !discordUserId) {
    return { ok: false, message: "X ID か Discord User ID のどちらかが必要です。" };
  }

  let permissionKeys: CollaboratorPermissionKey[];
  try {
    permissionKeys = parsePermissionKeys(data.permission_keys);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "入力エラー" };
  }
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const now = Math.floor(Date.now() / 1000);
  if (xUserId) await ensureXUser(guard.db, xUserId, data.display_name, now);

  const existing = await findStaffBySubject(
    guard.db,
    data.event_id,
    xUserId,
    discordUserId,
  );
  const staffId = existing?.id ?? generateId("es");
  const nextRole: StaffRole =
    existing?.role === "editor" || existing?.role === "representative"
      ? existing.role
      : "staff";

  if (existing) {
    await guard.db
      .update(eventStaff)
      .set({
        x_user_id: xUserId ?? existing.x_user_id,
        discord_user_id: discordUserId ?? existing.discord_user_id,
        display_name: data.display_name,
        role: nextRole,
        is_public: data.is_public_staff,
        public_role_label: data.public_role_label ?? null,
        updated_at: now,
      })
      .where(eq(eventStaff.id, existing.id));
  } else {
    await guard.db.insert(eventStaff).values({
      id: staffId,
      event_id: data.event_id,
      x_user_id: xUserId,
      discord_user_id: discordUserId,
      display_name: data.display_name,
      role: nextRole,
      is_public: data.is_public_staff,
      public_role_label: data.public_role_label ?? null,
      internal_note: null,
      approved_by_user_id: guard.userId,
      approved_at: now,
      created_at: now,
      updated_at: now,
    });
  }
  await replacePermissions(guard.db, staffId, permissionKeys, now);
  await writeStaffLog({
    db: guard.db,
    table: "event_staff_permissions",
    recordId: staffId,
    action: existing ? "UPDATE" : "CREATE",
    userId: guard.userId,
    payload: { display_name: data.display_name, keys: permissionKeys },
    now,
  });

  revalidateEventStaffPaths(data.event_id);
  return { ok: true };
}

export async function removeCollaborator(
  formData: FormData,
): Promise<StaffActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const discordUserId = String(formData.get("discord_user_id") ?? "").trim() || null;
  if (!eventId || (!xUserId && !discordUserId)) {
    return { ok: false, message: "event_id と x_user_id or discord_user_id が必要です。" };
  }
  const guard = await ensureAdminFor(eventId);
  if (!guard.ok) return guard.result;
  const existing = await findStaffBySubject(
    guard.db,
    eventId,
    xUserId || null,
    discordUserId,
  );
  if (!existing) return { ok: true };
  const now = Math.floor(Date.now() / 1000);

  await guard.db
    .delete(eventStaffPermissions)
    .where(eq(eventStaffPermissions.event_staff_id, existing.id));
  if (existing.role === "staff") {
    await guard.db.delete(eventStaff).where(eq(eventStaff.id, existing.id));
  }
  await writeStaffLog({
    db: guard.db,
    table: "event_staff_permissions",
    recordId: existing.id,
    action: "DELETE",
    userId: guard.userId,
    now,
  });

  revalidateEventStaffPaths(eventId);
  return { ok: true };
}
