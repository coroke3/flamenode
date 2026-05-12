"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  historyLogs,
  users,
  customPages,
  xAccountLinkRequests,
  xUsers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

export interface XIdActionResult {
  ok: boolean;
  message?: string;
}

export async function setActiveXId(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "X ID が指定されていません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const xRow = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!xRow) return { ok: false, message: "X ID が見つかりません。" };
  if (xRow.linked_discord_user_id !== u.id) {
    return {
      ok: false,
      message: "この X ID は現在のアカウントに紐づいていません。",
    };
  }
  if (xRow.approval_status === "rejected") {
    return {
      ok: false,
      message: "却下された X ID はアクティブにできません。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(users)
    .set({ active_x_user_id: xUserId })
    .where(eq(users.id, u.id));

  await db.insert(historyLogs).values({
    table_name: "user",
    record_id: u.id,
    action: "UPDATE",
    after_data: JSON.stringify({ active_x_user_id: xUserId }),
    operator_discord_id: u.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "アクティブ X ID を切り替えました。" };
}

export async function requestXIdLink(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const requestedXId = normalizeXId(String(formData.get("x_id") ?? ""));
  if (!requestedXId || !/^[a-z0-9_]{1,20}$/.test(requestedXId)) {
    return {
      ok: false,
      message: "X ID は英数字とアンダースコア 1 から 20 文字で入力してください。",
    };
  }

  const linkType = String(formData.get("link_type") ?? "new") as
    | "new"
    | "merge"
    | "alias";

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existingUser = (
    await db.select().from(xUsers).where(eq(xUsers.id, requestedXId)).limit(1)
  )[0];
  if (existingUser?.linked_discord_user_id === u.id) {
    return {
      ok: false,
      message: "この X ID はすでに現在のアカウントに紐づいています。",
    };
  }
  if (
    existingUser?.linked_discord_user_id &&
    existingUser.linked_discord_user_id !== u.id
  ) {
    return {
      ok: false,
      message: "この X ID は別の Discord アカウントに紐づいています。",
    };
  }

  const dupPending = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(
        and(
          eq(xAccountLinkRequests.discord_user_id, u.id),
          eq(xAccountLinkRequests.requested_x_id, requestedXId),
          eq(xAccountLinkRequests.status, "pending"),
        )!,
      )
      .limit(1)
  )[0];
  if (dupPending) {
    return {
      ok: true,
      message: "同じ X ID の連携申請がすでに承認待ちです。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const id = generateId("xreq");

  await db.insert(xAccountLinkRequests).values({
    id,
    discord_user_id: u.id,
    requested_x_id: requestedXId,
    link_type: linkType,
    status: "pending",
    requested_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "x_account_link_requests",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ requested_x_id: requestedXId, link_type: linkType }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: "連携申請を受け付けました。承認後、一覧に表示されます。",
  };
}

export async function updateXIdProfile(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const xName = String(formData.get("x_name") ?? "").trim();
  const iconUrl = String(formData.get("icon_url") ?? "").trim();
  const profileText = String(formData.get("profile_text") ?? "").trim();
  const youtubeChannelUrl = String(formData.get("youtube_channel_url") ?? "").trim();
  const otherSocialLinks = String(formData.get("other_social_links") ?? "").trim();
  if (!xUserId || !xName) {
    return { ok: false, message: "X ID と表示名が必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== u.id) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  await db
    .update(xUsers)
    .set({
      x_name: xName,
      icon_url: iconUrl || null,
      profile_text: profileText || null,
      youtube_channel_url: youtubeChannelUrl || null,
      other_social_links: otherSocialLinks || null,
    })
    .where(eq(xUsers.id, xUserId));

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ x_name: xName }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "X ID のプロフィールを更新しました。" };
}

export async function enablePortfolio(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== u.id) {
    return { ok: false, message: "この X ID のポートフォリオを編集できません。" };
  }
  const now = Math.floor(Date.now() / 1000);
  const existing = (
    await db.select().from(customPages).where(eq(customPages.x_user_id, xUserId)).limit(1)
  )[0];
  const html = `<h1>${row.x_name}</h1><p>${row.profile_text ?? ""}</p>`;
  if (existing) {
    await db
      .update(customPages)
      .set({ is_published: 1, updated_at: now })
      .where(eq(customPages.id, existing.id));
  } else {
    await db.insert(customPages).values({
      id: generateId("page"),
      x_user_id: xUserId,
      html,
      css: "",
      is_published: 1,
      updated_at: now,
    });
  }
  revalidatePath("/dashboard/settings");
  revalidatePath(`/user/${xUserId}`);
  revalidatePath(`/user/${xUserId}/portfolio`);
  return { ok: true, message: "ポートフォリオを有効化しました。" };
}

export async function deleteLinkedXId(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== `DELETE ${xUserId}`) {
    return { ok: false, message: `確認のため DELETE ${xUserId} と入力してください。` };
  }
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== u.id) {
    return { ok: false, message: "この X ID の連携を削除できません。" };
  }
  await db
    .update(xUsers)
    .set({ linked_discord_user_id: null, approval_status: "pending" })
    .where(eq(xUsers.id, xUserId));
  await db
    .update(users)
    .set({ active_x_user_id: null })
    .where(and(eq(users.id, u.id), eq(users.active_x_user_id, xUserId))!);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ linked_discord_user_id: null }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "X ID 連携を削除しました。" };
}
