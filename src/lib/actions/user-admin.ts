"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { notificationOutbox, users, videos, xUsers } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { createTraceId } from "@/lib/observability/flowTrace";
import { normalizeXId } from "@/lib/utils/xid";
import {
  parseSetUserBannedInput,
  parseSetUserCanCreateEventsInput,
  parseSetUserNotificationsInput,
  parseSetUserRoleInput,
  userNotificationsAuditReason,
} from "@flamenode/domain/user";

export interface UserAdminResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}

type UserRow = typeof users.$inferSelect;
type UserPatch = Partial<typeof users.$inferInsert>;

function snapshot(row: object): Record<string, unknown> {
  return { ...row };
}

function mutationError(error: unknown): UserAdminResult {
  unstable_rethrow(error);
  console.error("[user-admin] atomic mutation failed", error);
  return {
    ok: false,
    message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
  };
}

function revalidateUserDetailPaths(userId: string): void {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

async function revalidateUserDetailPathsBestEffort(userId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "user_admin", traceId: createTraceId() },
    [
      {
        name: "revalidate_user_detail_paths",
        run: async () => {
          revalidateUserDetailPaths(userId);
        },
      },
    ],
  );
}

async function revalidateUserNotificationPathsBestEffort(userId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "user_admin_notifications", traceId: createTraceId() },
    [
      {
        name: "revalidate_user_notification_paths",
        run: async () => {
          revalidateUserDetailPaths(userId);
          revalidatePath("/admin/notifications");
          revalidatePath("/manage/notifications");
        },
      },
    ],
  );
}

async function revalidateUserEventCreatePathsBestEffort(userId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "user_admin_event_create", traceId: createTraceId() },
    [
      {
        name: "revalidate_user_event_create_paths",
        run: async () => {
          revalidateUserDetailPaths(userId);
          revalidatePath(`/admin/users/${userId}/edit`);
        },
      },
    ],
  );
}

async function revalidateXUserIconPathsBestEffort(xUserId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_x_icon_refresh", traceId: createTraceId() },
    [
      {
        name: "revalidate_x_user_icon_paths",
        run: async () => {
          revalidatePath(`/user/${xUserId}`);
        },
      },
    ],
  );
}

async function updateUserAtomic(input: {
  db: NonNullable<ReturnType<typeof getDatabase>>;
  actorUserId: string;
  target: UserRow;
  patch: UserPatch;
  retentionClass: "normal" | "long_audit";
  context: string;
  reason?: string | null;
  extraStatements?: BatchItem<"sqlite">[];
  extraExpectedChanges?: number[];
}): Promise<UserAdminResult> {
  const after = { ...input.target, ...input.patch };
  const userUpdate = input.db
    .update(users)
    .set(input.patch)
    .where(
      and(
        eq(users.id, input.target.id),
        expectedRowCondition({ expectedCurrent: snapshot(input.target) }),
      )!,
    );
  const statements: BatchItem<"sqlite">[] = [
    userUpdate,
    ...(input.extraStatements ?? []),
  ];
  const expected = [1, ...(input.extraExpectedChanges ?? [])];

  try {
    await mutateWithAudit(input.db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits: [
        {
          table_name: "user",
          target_id: input.target.id,
          operation: "UPDATE",
          before: snapshot(input.target),
          after: snapshot(after),
          actor_user_id: input.actorUserId,
          retention_class: input.retentionClass,
          context: input.context,
          reason: input.reason ?? null,
          strict: true,
        },
      ],
    });
    return { ok: true };
  } catch (error) {
    return mutationError(error);
  }
}

async function getTargetUser(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  userId: string,
): Promise<UserRow | null> {
  return (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0] ?? null;
}

export async function setUserRole(formData: FormData): Promise<UserAdminResult> {
  const guard = await requireAdminWrite("admin_user_role");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseSetUserRoleInput(Object.fromEntries(formData), guard.user.id);
  if (!parsed.ok) return parsed;
  const { user_id, role } = parsed;
  const { db } = guard;
  const target = await getTargetUser(db, user_id);
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };
  const result = await updateUserAtomic({
    db,
    actorUserId: guard.user.id,
    target,
    patch: { role },
    retentionClass: "long_audit",
    context: "admin_user_role",
  });
  if (result.ok) {
    await revalidateUserDetailPathsBestEffort(user_id);
  }
  return result;
}

export async function setUserBanned(formData: FormData): Promise<UserAdminResult> {
  const guard = await requireAdminWrite("admin_user_ban");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseSetUserBannedInput(Object.fromEntries(formData), guard.user.id);
  if (!parsed.ok) return parsed;
  const { user_id, is_banned, auditReason } = parsed;
  const { db } = guard;
  const target = await getTargetUser(db, user_id);
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };
  const result = await updateUserAtomic({
    db,
    actorUserId: guard.user.id,
    target,
    patch: { is_banned },
    retentionClass: "long_audit",
    context: "admin_user_ban",
    reason: auditReason,
  });
  if (result.ok) {
    await revalidateUserDetailPathsBestEffort(user_id);
  }
  return result;
}

export async function setUserNotifications(
  formData: FormData,
): Promise<UserAdminResult> {
  const guard = await requireAdminWrite("admin_user_notifications");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseSetUserNotificationsInput(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;

  const { db } = guard;
  const target = await getTargetUser(db, parsed.user_id);
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };

  const disabling = parsed.is_notification_enabled === 0;
  const now = Math.floor(Date.now() / 1000);
  const pendingCount = disabling
    ? Number(
        (
          await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(notificationOutbox)
            .where(
              and(
                eq(notificationOutbox.recipient_user_id, target.id),
                eq(notificationOutbox.status, "pending"),
              ),
            )
        )[0]?.count ?? 0,
      )
    : 0;
  const pendingCancellation = disabling
    ? db
        .update(notificationOutbox)
        .set({
          status: "cancelled",
          processing_started_at: null,
          lease_token: null,
          lease_expires_at: null,
          next_attempt_at: null,
          last_error: "notification disabled before delivery",
          processed_at: now,
        })
        .where(
          and(
            eq(notificationOutbox.recipient_user_id, target.id),
            eq(notificationOutbox.status, "pending"),
          )!,
        )
    : null;

  const result = await updateUserAtomic({
    db,
    actorUserId: guard.user.id,
    target,
    patch: { is_notification_enabled: parsed.is_notification_enabled },
    retentionClass: "normal",
    context: "admin_user_notifications",
    reason: userNotificationsAuditReason(disabling, pendingCount),
    extraStatements: pendingCancellation ? [pendingCancellation] : [],
    extraExpectedChanges: pendingCancellation ? [pendingCount] : [],
  });

  if (result.ok) {
    await revalidateUserNotificationPathsBestEffort(parsed.user_id);
  }
  return result;
}

export async function setUserCanCreateEvents(
  formData: FormData,
): Promise<UserAdminResult> {
  const guard = await requireAdminWrite("admin_user_event_create");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = parseSetUserCanCreateEventsInput(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const { db } = guard;
  const target = await getTargetUser(db, parsed.user_id);
  if (!target) return { ok: false, message: "対象ユーザーが見つかりません。" };
  const result = await updateUserAtomic({
    db,
    actorUserId: guard.user.id,
    target,
    patch: { can_create_events: parsed.can_create_events },
    retentionClass: "long_audit",
    context: "admin_user_event_create",
  });
  if (result.ok) {
    await revalidateUserEventCreatePathsBestEffort(parsed.user_id);
  }
  return result;
}

export async function refreshXUserIcon(formData: FormData): Promise<UserAdminResult> {
  const guard = await requireAdminWrite("admin_x_icon_refresh");
  if (!guard.ok) return { ok: false, message: guard.message };
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "x_user_id が必要です。" };
  const { db } = guard;
  const target = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象Xユーザーが見つかりません。" };
  const latest = (
    await db
      .select({ icon_url: videos.creator_icon_url })
      .from(videos)
      .where(
        and(
          eq(videos.creator_x_user_id, xUserId),
          isNotNull(videos.creator_icon_url),
          inArray(videos.collaboration_type, ["individual", "collab"]),
          ne(videos.visibility_status, "voided"),
        )!,
      )
      .orderBy(
        sql`CASE WHEN ${videos.collaboration_type} = 'individual' THEN 0 ELSE 1 END`,
        desc(videos.created_at),
      )
      .limit(1)
  )[0];
  if (!latest?.icon_url) {
    return { ok: false, message: "候補アイコンが見つかりませんでした。" };
  }
  const after = { ...target, icon_url: latest.icon_url };
  const queue = await buildStaticRebuildQueueBatch(db, [
    {
      targetType: "user",
      targetId: xUserId,
      reason: "admin_x_icon_refresh",
      priority: "normal",
      requestedByUserId: guard.user.id,
    },
    {
      targetType: "users_index",
      targetId: "global",
      reason: "admin_x_icon_refresh",
      priority: "normal",
      requestedByUserId: guard.user.id,
    },
  ]);
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(xUsers)
          .set({ icon_url: latest.icon_url })
          .where(
            and(
              eq(xUsers.id, xUserId),
              expectedRowCondition({ expectedCurrent: snapshot(target) }),
            )!,
          ),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [
        {
          table_name: "x_users",
          target_id: xUserId,
          operation: "UPDATE",
          before: snapshot(target),
          after: snapshot(after),
          actor_user_id: guard.user.id,
          retention_class: "normal",
          context: "admin_x_icon_refresh",
          reason: "作品の最新アイコンから再計算",
          strict: true,
        },
      ],
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  await revalidateXUserIconPathsBestEffort(xUserId);
  return markPendingPublicReflection({ ok: true }, queue.statements.length > 0);
}
