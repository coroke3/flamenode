"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import {
  eventCollaboratorPermissions,
  eventEditors,
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

async function ensureAdminFor(eventId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: StaffActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id)
    return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  const db = getDatabase();
  if (!db)
    return {
      ok: false,
      result: { ok: false, message: "DB に接続できません。" },
    };
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
  return { ok: true, userId: u.id };
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
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  data.x_user_id = normalizeXId(data.x_user_id);
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // X user が無ければ pending で作成
  const xRow = (
    await db.select().from(xUsers).where(eq(xUsers.id, data.x_user_id)).limit(1)
  )[0];
  const now = Math.floor(Date.now() / 1000);
  if (!xRow) {
    await db.insert(xUsers).values({
      id: data.x_user_id,
      x_name: `@${data.x_user_id}`,
      approval_status: "pending",
      approval_requested_at: now,
    });
  }

  // 既存
  const dup = (
    await db
      .select()
      .from(eventEditors)
      .where(
        and(
          eq(eventEditors.event_id, data.event_id),
          eq(eventEditors.x_user_id, data.x_user_id),
        )!,
      )
      .limit(1)
  )[0];
  if (dup) return { ok: false, message: "既に登録されています。" };

  await db.insert(eventEditors).values({
    event_id: data.event_id,
    x_user_id: data.x_user_id,
    role: data.role,
    is_public: data.is_public,
    public_role_label: data.public_role_label ?? null,
    internal_note: data.internal_note ?? null,
    approved_by_user_id: guard.userId,
    approved_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "event_editors",
    record_id: `${data.event_id}:${data.x_user_id}`,
    action: "CREATE",
    after_data: JSON.stringify({ role: data.role, is_public: data.is_public }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/events/${data.event_id}/staff`);
  revalidatePath(`/admin/events/${data.event_id}`);
  revalidatePath(`/event/${data.event_id}`);
  return { ok: true };
}

export async function removeEventEditor(
  formData: FormData,
): Promise<StaffActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!eventId || !xUserId)
    return { ok: false, message: "event_id と x_user_id が必要です。" };
  const guard = await ensureAdminFor(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .delete(eventEditors)
    .where(
      and(
        eq(eventEditors.event_id, eventId),
        eq(eventEditors.x_user_id, xUserId),
      )!,
    );

  await db.insert(historyLogs).values({
    table_name: "event_editors",
    record_id: `${eventId}:${xUserId}`,
    action: "DELETE",
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/events/${eventId}/staff`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
  return { ok: true };
}

const updateEditorSchema = addEditorSchema.extend({});

export async function updateEventEditor(
  formData: FormData,
): Promise<StaffActionResult> {
  const parsed = updateEditorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  if (data.x_user_id) data.x_user_id = normalizeXId(data.x_user_id);
  if (data.x_user_id) data.x_user_id = normalizeXId(data.x_user_id);
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(eventEditors)
    .set({
      role: data.role,
      is_public: data.is_public,
      public_role_label: data.public_role_label ?? null,
      internal_note: data.internal_note ?? null,
    })
    .where(
      and(
        eq(eventEditors.event_id, data.event_id),
        eq(eventEditors.x_user_id, data.x_user_id),
      )!,
    );

  await db.insert(historyLogs).values({
    table_name: "event_editors",
    record_id: `${data.event_id}:${data.x_user_id}`,
    action: "UPDATE",
    after_data: JSON.stringify({ role: data.role, is_public: data.is_public }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/admin/events/${data.event_id}/staff`);
  revalidatePath(`/admin/events/${data.event_id}`);
  revalidatePath(`/event/${data.event_id}`);
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
  if (typeof raw.x_user_id === "string" && raw.x_user_id.trim() === "")
    raw.x_user_id = null as never;
  if (typeof raw.discord_user_id === "string" && raw.discord_user_id.trim() === "")
    raw.discord_user_id = null as never;
  const parsed = collabSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const data = parsed.data;
  if (data.x_user_id) data.x_user_id = normalizeXId(data.x_user_id);
  if (!data.x_user_id && !data.discord_user_id) {
    return {
      ok: false,
      message: "X ID か Discord User ID のどちらかは必要です。",
    };
  }
  const guard = await ensureAdminFor(data.event_id);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const permKeys = (data.permission_keys ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as CollaboratorPermissionKey[];
  const invalid = permKeys.find(
    (k) => !COLLABORATOR_PERMISSION_KEYS.includes(k),
  );
  if (invalid)
    return { ok: false, message: `不正な permission_key: ${invalid}` };

  const now = Math.floor(Date.now() / 1000);

  // X user 自動作成
  if (data.x_user_id) {
    const xRow = (
      await db.select().from(xUsers).where(eq(xUsers.id, data.x_user_id)).limit(1)
    )[0];
    if (!xRow) {
      await db.insert(xUsers).values({
        id: data.x_user_id,
        x_name: data.display_name || `@${data.x_user_id}`,
        approval_status: "pending",
        approval_requested_at: now,
      });
    }
  }

  // 既存の collaborator 行を一度全て削除し、permKeys を再登録 (idempotent)
  if (data.x_user_id) {
    await db
      .delete(eventCollaboratorPermissions)
      .where(
        and(
          eq(eventCollaboratorPermissions.event_id, data.event_id),
          eq(eventCollaboratorPermissions.x_user_id, data.x_user_id),
        )!,
      );
  }
  if (data.discord_user_id) {
    await db
      .delete(eventCollaboratorPermissions)
      .where(
        and(
          eq(eventCollaboratorPermissions.event_id, data.event_id),
          eq(eventCollaboratorPermissions.discord_user_id, data.discord_user_id),
        )!,
      );
  }

  for (const key of permKeys) {
    await db.insert(eventCollaboratorPermissions).values({
      id: generateId("ecp"),
      event_id: data.event_id,
      x_user_id: data.x_user_id ?? null,
      discord_user_id: data.discord_user_id ?? null,
      display_name: data.display_name,
      permission_key: key,
      allowed: 1,
      is_public_staff: data.is_public_staff,
      public_role_label: data.public_role_label ?? null,
      granted_by_user_id: guard.userId,
      created_at: now,
      updated_at: now,
    });
  }

  await db.insert(historyLogs).values({
    table_name: "event_collaborator_permissions",
    record_id: `${data.event_id}:${data.x_user_id ?? data.discord_user_id}`,
    action: "UPDATE",
    after_data: JSON.stringify({
      display_name: data.display_name,
      keys: permKeys,
    }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/events/${data.event_id}/staff`);
  revalidatePath(`/admin/events/${data.event_id}`);
  return { ok: true };
}

export async function removeCollaborator(
  formData: FormData,
): Promise<StaffActionResult> {
  const eventId = String(formData.get("event_id") ?? "").trim();
  const xUserId = String(formData.get("x_user_id") ?? "").trim();
  const discordUserId = String(formData.get("discord_user_id") ?? "").trim();
  if (!eventId || (!xUserId && !discordUserId)) {
    return {
      ok: false,
      message: "event_id と x_user_id or discord_user_id が必要です。",
    };
  }
  const guard = await ensureAdminFor(eventId);
  if (!guard.ok) return guard.result;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  if (xUserId) {
    await db
      .delete(eventCollaboratorPermissions)
      .where(
        and(
          eq(eventCollaboratorPermissions.event_id, eventId),
          eq(eventCollaboratorPermissions.x_user_id, xUserId),
        )!,
      );
  }
  if (discordUserId) {
    await db
      .delete(eventCollaboratorPermissions)
      .where(
        and(
          eq(eventCollaboratorPermissions.event_id, eventId),
          eq(eventCollaboratorPermissions.discord_user_id, discordUserId),
        )!,
      );
  }

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "event_collaborator_permissions",
    record_id: `${eventId}:${xUserId || discordUserId}`,
    action: "DELETE",
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/events/${eventId}/staff`);
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: true };
}
