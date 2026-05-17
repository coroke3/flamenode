"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs,
  users,
  xAccountLinkRequests,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

async function getAdminUserId(): Promise<string | null> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") return null;
  return u.id;
}

/**
 * X ID 連携申請を承認し、`x_users` を作成または更新する。
 */
export async function approveXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const adminId = await getAdminUserId();
  if (!adminId) return { ok: false, message: "管理者のみ実行できます。" };

  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const reqRow = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(eq(xAccountLinkRequests.id, requestId))
      .limit(1)
  )[0];
  if (!reqRow) return { ok: false, message: "申請が見つかりません。" };
  if (reqRow.status !== "pending") {
    return { ok: false, message: "すでに処理済みの申請です。" };
  }

  const xid = normalizeXId(reqRow.requested_x_id);
  const discordUserId = reqRow.discord_user_id;

  const existing = (
    await db.select().from(xUsers).where(eq(xUsers.id, xid)).limit(1)
  )[0];
  if (
    existing?.linked_discord_user_id &&
    existing.linked_discord_user_id !== discordUserId
  ) {
    return {
      ok: false,
      message: "この X ID は別ユーザーに紐づいているため承認できません。",
    };
  }

  const now = Math.floor(Date.now() / 1000);

  if (!existing) {
    await db.insert(xUsers).values({
      id: xid,
      x_name: `@${xid}`,
      linked_discord_user_id: discordUserId,
      approval_status: "approved",
      approval_requested_at: now,
    });
  } else {
    await db
      .update(xUsers)
      .set({
        linked_discord_user_id: discordUserId,
        approval_status: "approved",
        approval_requested_at: now,
      })
      .where(eq(xUsers.id, xid));
  }

  await db
    .update(xAccountLinkRequests)
    .set({ status: "approved" })
    .where(eq(xAccountLinkRequests.id, requestId));

  const userRow = (
    await db.select().from(users).where(eq(users.id, discordUserId)).limit(1)
  )[0];
  if (userRow && !userRow.active_x_user_id) {
    await db
      .update(users)
      .set({ active_x_user_id: xid })
      .where(eq(users.id, discordUserId));
  }

  await db.insert(historyLogs).values({
    table_name: "x_account_link_requests",
    record_id: requestId,
    action: "UPDATE",
    after_data: JSON.stringify({ status: "approved", x_user_id: xid }),
    operator_discord_id: adminId,
    retention_class: "long_audit",
    created_at: now,
  });

  await enqueueNotification(db, {
    discordUserId: discordUserId,
    type: "x_id_approved",
    payload: {
      content: `X ID @${xid} の連携申請が承認されました。`,
      x_user_id: xid,
      request_id: requestId,
    },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/dashboard");
  return { ok: true, message: "承認しました。" };
}

/**
 * X ID 連携申請を却下する。
 */
export async function rejectXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const adminId = await getAdminUserId();
  if (!adminId) return { ok: false, message: "管理者のみ実行できます。" };

  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!requestId) return { ok: false, message: "申請 ID がありません。" };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const reqRow = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(eq(xAccountLinkRequests.id, requestId))
      .limit(1)
  )[0];
  if (!reqRow) return { ok: false, message: "申請が見つかりません。" };
  if (reqRow.status !== "pending") {
    return { ok: false, message: "すでに処理済みの申請です。" };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(xAccountLinkRequests)
    .set({ status: "rejected" })
    .where(eq(xAccountLinkRequests.id, requestId));

  await db.insert(historyLogs).values({
    table_name: "x_account_link_requests",
    record_id: requestId,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "rejected",
      reason: reason || null,
    }),
    operator_discord_id: adminId,
    retention_class: "long_audit",
    created_at: now,
  });

  await enqueueNotification(db, {
    discordUserId: reqRow.discord_user_id,
    type: "x_id_rejected",
    payload: {
      content: reason
        ? `X ID @${reqRow.requested_x_id} の連携申請が却下されました。理由: ${reason}`
        : `X ID @${reqRow.requested_x_id} の連携申請が却下されました。`,
      requested_x_id: reqRow.requested_x_id,
      request_id: requestId,
      reason: reason || null,
    },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/admin/x-link-requests");
  return { ok: true, message: "却下しました。" };
}
