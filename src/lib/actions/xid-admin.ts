"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { canManageXIdLinkRequests } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs,
  users,
  xAccountLinkRequests,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export interface XIdAdminResult {
  ok: boolean;
  message?: string;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;

async function getXIdLinkOperator(): Promise<{ userId: string; db: DB } | null> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return null;
  const db = getDatabase();
  if (!db) return null;
  const ok = await canManageXIdLinkRequests(db, {
    id: u.id,
    role: u.role ?? null,
  });
  if (!ok) return null;
  return { userId: u.id, db };
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

/**
 * X ID 連携申請を承認し、`x_users` を作成または更新する。
 */
export async function approveXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  const adminId = operator?.userId ?? null;
  if (!adminId) return { ok: false, message: "X ID 連携申請を処理する権限がありません。" };

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
  const now = Math.floor(Date.now() / 1000);
  const linkType = reqRow.link_type ?? "new";

  // ============================
  // link_type === "alias": x_user_aliases に行追加して終了。
  // 既存の target_x_user_id を主、申請された requested_x_id を別名として登録する。
  // x_users への新規行は作らない。投稿主体権限は target_x_user_id 側のまま。
  // ============================
  if (linkType === "alias") {
    const targetXId = reqRow.target_x_user_id
      ? normalizeXId(reqRow.target_x_user_id)
      : null;
    if (!targetXId) {
      return { ok: false, message: "alias 申請には target_x_user_id が必要です。" };
    }
    const targetRow = (
      await db.select().from(xUsers).where(xUserIdMatches(targetXId)).limit(1)
    )[0];
    if (!targetRow) {
      return { ok: false, message: "target_x_user_id が見つかりません。" };
    }
    if (
      targetRow.linked_discord_user_id &&
      targetRow.linked_discord_user_id !== discordUserId
    ) {
      return {
        ok: false,
        message: "target_x_user_id が別の Discord ユーザーに紐づいているため alias 追加できません。",
      };
    }
    // 既存 alias の重複は composite PK で防がれる
    await db
      .insert(xUserAliases)
      .values({ x_user_id: targetXId, alias_x_id: xid })
      .onConflictDoNothing();

    const approvedRows = await db
      .update(xAccountLinkRequests)
      .set({ status: "approved" })
      .where(
        and(
          eq(xAccountLinkRequests.id, requestId),
          eq(xAccountLinkRequests.status, "pending"),
        )!,
      )
      .returning({ id: xAccountLinkRequests.id });
    if (approvedRows.length === 0) {
      return { ok: false, message: "すでに処理済みの申請です。" };
    }

    await db.insert(historyLogs).values({
      table_name: "x_account_link_requests",
      record_id: requestId,
      action: "UPDATE",
      after_data: JSON.stringify({
        status: "approved",
        link_type: "alias",
        target_x_user_id: targetXId,
        alias_x_id: xid,
      }),
      operator_discord_id: adminId,
      retention_class: "long_audit",
      created_at: now,
    });

    await enqueueNotification(db, {
      discordUserId,
      type: "x_id_alias_approved",
      payload: {
        content: `X ID @${xid} を @${targetXId} の別名として承認しました。`,
        x_user_id: targetXId,
        alias_x_id: xid,
        request_id: requestId,
      },
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/admin/x-link-requests");
    revalidatePath("/manage/x-link-requests");
    return { ok: true, message: "alias として承認しました。" };
  }

  // ============================
  // link_type === "merge": 自動マージは危険操作のため拒否。手動対応を促す。
  // 旧データ吸収 / 投稿者付け替え / アイコン継承は監査ログ確認後に手動で行う。
  // ============================
  if (linkType === "merge") {
    return {
      ok: false,
      message:
        "merge 申請は自動承認の対象外です。/admin/audit に履歴を残してから手動で対応してください。",
    };
  }

  // ============================
  // link_type === "new": 既存実装どおり (x_users 行作成 or 既存行へ linked_discord_user_id 更新)
  // ============================
  const existing = (
    await db.select().from(xUsers).where(xUserIdMatches(xid)).limit(1)
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
      .where(xUserIdMatches(xid));
  }

  const approvedRows = await db
    .update(xAccountLinkRequests)
    .set({ status: "approved" })
    .where(
      and(
        eq(xAccountLinkRequests.id, requestId),
        eq(xAccountLinkRequests.status, "pending"),
      )!,
    )
    .returning({ id: xAccountLinkRequests.id });
  if (approvedRows.length === 0) {
    return { ok: false, message: "すでに処理済みの申請です。" };
  }

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
    after_data: JSON.stringify({
      status: "approved",
      link_type: "new",
      x_user_id: xid,
    }),
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
  revalidatePath("/manage/x-link-requests");
  revalidatePath("/dashboard");
  return { ok: true, message: "承認しました。" };
}

/**
 * X ID 連携申請を却下する。
 */
export async function rejectXIdLinkRequest(
  formData: FormData,
): Promise<XIdAdminResult> {
  const operator = await getXIdLinkOperator();
  const adminId = operator?.userId ?? null;
  if (!adminId) return { ok: false, message: "X ID 連携申請を処理する権限がありません。" };

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
  revalidatePath("/manage/x-link-requests");
  return { ok: true, message: "却下しました。" };
}
