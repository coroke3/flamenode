"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import {
  historyLogs,
  users,
  customPages,
  xAccountLinkRequests,
  xUsers,
  xUserIcons,
  videos,
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

export async function setXIdIcon(
  formData: FormData,
): Promise<XIdActionResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const iconUrl = String(formData.get("icon_url") ?? "").trim();
  if (!xUserId || !iconUrl) {
    return { ok: false, message: "X ID とアイコンが必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== u.id) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  const candidates = new Set<string>();
  if (row.icon_url) candidates.add(row.icon_url);
  const iconRows = await db
    .select({ icon_url: xUserIcons.icon_url })
    .from(xUserIcons)
    .where(eq(xUserIcons.x_user_id, xUserId))
    .orderBy(desc(xUserIcons.created_at))
    .limit(40);
  iconRows.forEach((r) => candidates.add(r.icon_url));

  const videoRows = await db
    .select({ icon_url: videos.icon_url })
    .from(videos)
    .where(
      and(
        or(eq(videos.creator_id, xUserId), eq(videos.contact_x_id, xUserId))!,
        isNotNull(videos.icon_url),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(40);
  videoRows.forEach((r) => {
    if (r.icon_url) candidates.add(r.icon_url);
  });

  if (!candidates.has(iconUrl)) {
    return { ok: false, message: "選択できないアイコンです。" };
  }

  await db
    .update(xUsers)
    .set({ icon_url: iconUrl })
    .where(eq(xUsers.id, xUserId));

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ icon_url: iconUrl, source: "select" }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "アイコンを更新しました。" };
}

export async function uploadXIdIcon(
  formData: FormData,
): Promise<XIdActionResult & { iconUrl?: string }> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const file = formData.get("icon_file");
  if (!xUserId || !(file instanceof File)) {
    return { ok: false, message: "画像ファイルが必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = (
    await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== u.id) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  const contentType = file.type || "image/png";
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(contentType)) {
    return { ok: false, message: "PNG/JPEG/WEBP のみアップロードできます。" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "2MB 以内の画像を選んでください。" };
  }

  const manualIconCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xUserIcons)
    .where(
      and(
        eq(xUserIcons.x_user_id, xUserId),
        eq(xUserIcons.source_type, "manual"),
      )!,
    );
  if (Number(manualIconCount[0]?.count ?? 0) >= 24) {
    return {
      ok: false,
      message:
        "手動アップロードの候補が上限に達しています。既存候補から選択してください。",
    };
  }

  const env = getEnv();
  if (!env.BUCKET) {
    return { ok: false, message: "ストレージが利用できません。" };
  }

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `xicons/${xUserId}/${generateId("xicon")}.${ext}`;
  const buf = await file.arrayBuffer();
  await env.BUCKET.put(key, buf, {
    httpMetadata: { contentType },
  });
  const iconUrl = `/api/media/${key}`;

  const now = Math.floor(Date.now() / 1000);
  await db.insert(xUserIcons).values({
    id: generateId("xicon"),
    x_user_id: xUserId,
    icon_url: iconUrl,
    source_video_id: null,
    source_type: "manual",
    created_at: now,
  });
  await db
    .update(xUsers)
    .set({ icon_url: iconUrl })
    .where(eq(xUsers.id, xUserId));

  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ icon_url: iconUrl, source: "upload" }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "アイコンをアップロードしました。", iconUrl };
}
