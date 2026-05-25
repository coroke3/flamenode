"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, users, videos, xUsers } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export interface UserAdminResult {
  ok: boolean;
  message?: string;
}

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: UserAdminResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin")
    return {
      ok: false,
      result: { ok: false, message: "管理者のみ操作できます。" },
    };
  return { ok: true, userId: u.id };
}

const roleSchema = z.object({
  user_id: z.string().trim().min(1),
  role: z.enum(["user", "moderator", "admin"]),
});

export async function setUserRole(formData: FormData): Promise<UserAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const { user_id, role } = parsed.data;
  if (user_id === guard.userId && role !== "admin") {
    return {
      ok: false,
      message: "自分自身の admin ロールは外せません。他の admin に依頼してください。",
    };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(users).where(eq(users.id, user_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.update(users).set({ role }).where(eq(users.id, user_id));

  await db.insert(historyLogs).values({
    table_name: "user",
    record_id: user_id,
    action: "UPDATE",
    before_data: JSON.stringify({ role: target.role }),
    after_data: JSON.stringify({ role }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/users/${user_id}`);
  revalidatePath("/admin/users");
  return { ok: true };
}

const banSchema = z.object({
  user_id: z.string().trim().min(1),
  is_banned: z.coerce.number().min(0).max(1),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function setUserBanned(
  formData: FormData,
): Promise<UserAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = banSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const { user_id, is_banned, reason } = parsed.data;
  if (user_id === guard.userId && is_banned === 1) {
    return { ok: false, message: "自分自身を BAN にはできません。" };
  }
  if (is_banned === 1 && !reason) {
    return { ok: false, message: "BAN には理由が必要です。" };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(users).where(eq(users.id, user_id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.update(users).set({ is_banned }).where(eq(users.id, user_id));

  await db.insert(historyLogs).values({
    table_name: "user",
    record_id: user_id,
    action: "UPDATE",
    before_data: JSON.stringify({ is_banned: target.is_banned }),
    after_data: JSON.stringify({ is_banned, reason: reason || null }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath(`/admin/users/${user_id}`);
  revalidatePath("/admin/users");
  return { ok: true };
}

const notifSchema = z.object({
  user_id: z.string().trim().min(1),
  is_notification_enabled: z.coerce.number().min(0).max(1),
});

export async function setUserNotifications(
  formData: FormData,
): Promise<UserAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = notifSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const { user_id, is_notification_enabled } = parsed.data;
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(users).where(eq(users.id, user_id)).limit(1)
  )[0];
  if (!target) {
    return { ok: false, message: "対象ユーザーが見つかりません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(users)
    .set({ is_notification_enabled })
    .where(eq(users.id, user_id));

  await db.insert(historyLogs).values({
    table_name: "user",
    record_id: user_id,
    action: "UPDATE",
    before_data: JSON.stringify({ is_notification_enabled: target.is_notification_enabled }),
    after_data: JSON.stringify({ is_notification_enabled }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/admin/users/${user_id}`);
  return { ok: true };
}

/**
 * X user のアイコンを「同 creator_x_user_id の最新作品の icon_url」から再計算して反映する。
 * legacy import 由来の `x_users.icon_url = NULL` を救済する管理者操作。
 */
export async function refreshXUserIcon(
  formData: FormData,
): Promise<UserAdminResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "x_user_id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // 個人作 → 合作の順で latest icon を探す
  const findLatestIcon = async (
    submissionType: "individual" | "collab",
  ): Promise<string | null> => {
    const rows = await db
      .select({ icon_url: videos.creator_icon_url })
      .from(videos)
      .where(
        and(
          eq(videos.creator_x_user_id, xUserId),
          isNotNull(videos.creator_icon_url),
          eq(videos.collaboration_type, submissionType),
          ne(videos.visibility_status, "archived"),
        )!,
      )
      .orderBy(desc(videos.created_at))
      .limit(1);
    return rows[0]?.icon_url ?? null;
  };

  const newIcon = (await findLatestIcon("individual")) ?? (await findLatestIcon("collab"));
  if (!newIcon) {
    return { ok: false, message: "候補アイコンが見つかりませんでした。" };
  }

  await db
    .update(xUsers)
    .set({ icon_url: newIcon })
    .where(eq(xUsers.id, xUserId));

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ icon_url: newIcon, source: "videos_latest" }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath(`/user/${xUserId}`);
  return { ok: true };
}
