"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import {
  historyLogs,
  users,
  videos,
  xAccountLinkRequests,
  xUserIcons,
  xUsers,
} from "@/lib/db/schema";
import { detectSupportedImageUpload } from "@/lib/utils/imageUpload";
import { generateId } from "@/lib/utils/id";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { normalizeXId } from "@/lib/utils/xid";

export interface XIdActionResult {
  ok: boolean;
  message?: string;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

async function getSessionUserId(): Promise<string | null> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string } | undefined;
  return user?.id ?? null;
}

function sanitizeSocialLinks(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 2000) return null;
  if (/\b(?:javascript|vbscript|data):/i.test(value)) return null;
  return value;
}

async function assertLinkedXUser(db: NonNullable<ReturnType<typeof getDatabase>>, xUserId: string, userId: string) {
  const row = (
    await db.select().from(xUsers).where(xUserIdMatches(xUserId)).limit(1)
  )[0];
  if (!row || row.linked_discord_user_id !== userId) return null;
  return row;
}

export async function setActiveXId(
  formData: FormData,
): Promise<XIdActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "X ID が指定されていません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const xRow = await assertLinkedXUser(db, xUserId, userId);
  if (!xRow) {
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

  const now = nowUnix();
  await db
    .update(users)
    .set({ active_x_user_id: xUserId })
    .where(eq(users.id, userId));

  await db.insert(historyLogs).values({
    table_name: "user",
    record_id: userId,
    action: "UPDATE",
    after_data: JSON.stringify({ active_x_user_id: xUserId }),
    operator_discord_id: userId,
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
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const requestedXId = normalizeXId(String(formData.get("x_id") ?? ""));
  if (!requestedXId || !/^[a-z0-9_]{1,20}$/.test(requestedXId)) {
    return {
      ok: false,
      message: "X ID は英数字とアンダースコア 1 から 20 文字で入力してください。",
    };
  }

  const parsedLinkType = z
    .enum(["new", "merge", "alias"])
    .safeParse(String(formData.get("link_type") ?? "new"));
  if (!parsedLinkType.success) {
    return { ok: false, message: "不正な連携種別です。" };
  }
  const linkType = parsedLinkType.data;
  const targetXUserId = normalizeXId(
    String(formData.get("target_x_user_id") ?? ""),
  );

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existingUser = (
    await db.select().from(xUsers).where(xUserIdMatches(requestedXId)).limit(1)
  )[0];
  if (existingUser?.linked_discord_user_id === userId) {
    return {
      ok: false,
      message: "この X ID はすでに現在のアカウントに紐づいています。",
    };
  }
  if (
    existingUser?.linked_discord_user_id &&
    existingUser.linked_discord_user_id !== userId &&
    linkType !== "merge"
  ) {
    return {
      ok: false,
      message: "この X ID は別の Discord アカウントに紐づいています。統合申請を選んでください。",
    };
  }

  const dupPending = (
    await db
      .select()
      .from(xAccountLinkRequests)
      .where(
        and(
          eq(xAccountLinkRequests.discord_user_id, userId),
          sql`lower(${xAccountLinkRequests.requested_x_id}) = ${requestedXId}`,
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

  const pendingCountRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xAccountLinkRequests)
    .where(
      and(
        eq(xAccountLinkRequests.discord_user_id, userId),
        eq(xAccountLinkRequests.status, "pending"),
      )!,
    );
  if (Number(pendingCountRows[0]?.count ?? 0) >= 5) {
    return {
      ok: false,
      message: "未処理の X ID 申請が多すぎます。承認または却下を待ってから再申請してください。",
    };
  }

  const now = nowUnix();
  const id = generateId("xreq");
  await db.insert(xAccountLinkRequests).values({
    id,
    discord_user_id: userId,
    requested_x_id: requestedXId,
    link_type: linkType,
    target_x_user_id: targetXUserId || null,
    status: "pending",
    requested_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "x_account_link_requests",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({
      requested_x_id: requestedXId,
      link_type: linkType,
      target_x_user_id: targetXUserId || null,
    }),
    operator_discord_id: userId,
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
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const xName = String(formData.get("x_name") ?? "").trim();
  const profileText = String(formData.get("profile_text") ?? "").trim();
  const youtubeChannelRaw = String(
    formData.get("youtube_channel_url") ?? "",
  ).trim();
  const otherSocialLinksRaw = String(
    formData.get("other_social_links") ?? "",
  ).trim();
  const youtubeChannelUrl = youtubeChannelRaw
    ? normalizeHttpUrl(youtubeChannelRaw, { maxLength: 500 })
    : null;
  const otherSocialLinks = sanitizeSocialLinks(otherSocialLinksRaw);

  if (!xUserId || !xName) {
    return { ok: false, message: "X ID と表示名が必要です。" };
  }
  if (youtubeChannelRaw && !youtubeChannelUrl) {
    return {
      ok: false,
      message: "YouTube チャンネル URL は http/https の有効な URL を入力してください。",
    };
  }
  if (otherSocialLinksRaw && !otherSocialLinks) {
    return {
      ok: false,
      message: "SNS リンクに利用できない URL スキームが含まれています。",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await assertLinkedXUser(db, xUserId, userId);
  if (!row) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  await db
    .update(xUsers)
    .set({
      x_name: xName,
      profile_text: profileText || null,
      youtube_channel_url: youtubeChannelUrl,
      other_social_links: otherSocialLinks,
    })
    .where(xUserIdMatches(xUserId));

  const now = nowUnix();
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({
      x_name: xName,
      profile_text: profileText || null,
      youtube_channel_url: youtubeChannelUrl,
      other_social_links: otherSocialLinks,
    }),
    operator_discord_id: userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "X ID のプロフィールを更新しました。" };
}

export async function enablePortfolio(
  _formData: FormData,
): Promise<XIdActionResult> {
  void _formData;
  return {
    ok: false,
    message: "Portfolio/custom_pages は初期本番では準備中です。",
  };
}

export async function deleteLinkedXId(
  formData: FormData,
): Promise<XIdActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!xUserId || confirm !== `DELETE ${xUserId}`) {
    return {
      ok: false,
      message: `確認のため DELETE ${xUserId} と入力してください。`,
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await assertLinkedXUser(db, xUserId, userId);
  if (!row) {
    return { ok: false, message: "この X ID の連携を削除できません。" };
  }

  await db
    .update(xUsers)
    .set({ linked_discord_user_id: null, approval_status: "pending" })
    .where(xUserIdMatches(xUserId));
  await db
    .update(users)
    .set({ active_x_user_id: null })
    .where(
      and(eq(users.id, userId), sql`lower(${users.active_x_user_id}) = ${xUserId}`)!,
    );

  const now = nowUnix();
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ linked_discord_user_id: null }),
    operator_discord_id: userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "X ID 連携を削除しました。" };
}

export async function setXIdIcon(
  formData: FormData,
): Promise<XIdActionResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const iconUrl = String(formData.get("icon_url") ?? "").trim();
  if (!xUserId || !iconUrl) {
    return { ok: false, message: "X ID とアイコンが必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await assertLinkedXUser(db, xUserId, userId);
  if (!row) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  const candidates = new Set<string>();
  if (row.icon_url) candidates.add(row.icon_url);

  const iconRows = await db
    .select({ icon_url: xUserIcons.icon_url })
    .from(xUserIcons)
    .where(sql`lower(${xUserIcons.x_user_id}) = ${xUserId}`)
    .orderBy(desc(xUserIcons.created_at))
    .limit(40);
  iconRows.forEach((r) => candidates.add(r.icon_url));

  const videoRows = await db
    .select({ icon_url: videos.creator_icon_url })
    .from(videos)
    .where(
      and(
        sql`lower(${videos.creator_x_user_id}) = ${xUserId}`,
        isNotNull(videos.creator_icon_url),
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

  await db.update(xUsers).set({ icon_url: iconUrl }).where(xUserIdMatches(xUserId));

  const now = nowUnix();
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ icon_url: iconUrl, source: "select" }),
    operator_discord_id: userId,
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
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "ログインが必要です。" };

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const file = formData.get("icon_file");
  if (!xUserId || !(file instanceof File)) {
    return { ok: false, message: "画像ファイルが必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await assertLinkedXUser(db, xUserId, userId);
  if (!row) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }

  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "2MB 以内の画像を選んでください。" };
  }

  const manualIconCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xUserIcons)
    .where(
      and(
        sql`lower(${xUserIcons.x_user_id}) = ${xUserId}`,
        eq(xUserIcons.source_type, "manual"),
      )!,
    );
  if (Number(manualIconCount[0]?.count ?? 0) >= 24) {
    return {
      ok: false,
      message: "手動アップロードの候補が上限に達しています。既存候補から選択してください。",
    };
  }

  const env = getEnv();
  if (!env.BUCKET) {
    return { ok: false, message: "ストレージが利用できません。" };
  }

  const buffer = await file.arrayBuffer();
  const image = detectSupportedImageUpload(buffer);
  if (!image) {
    return {
      ok: false,
      message: "PNG/JPEG/WEBP 画像ファイルのみアップロードできます。",
    };
  }

  const key = `xicons/${xUserId}/${generateId("xicon")}.${image.ext}`;
  await env.BUCKET.put(key, buffer, {
    httpMetadata: { contentType: image.contentType },
  });
  const iconUrl = `/api/media/${key}`;

  const now = nowUnix();
  await db.insert(xUserIcons).values({
    id: generateId("xicon"),
    x_user_id: xUserId,
    icon_url: iconUrl,
    source_video_id: null,
    source_type: "manual",
    created_at: now,
  });
  await db.update(xUsers).set({ icon_url: iconUrl }).where(xUserIdMatches(xUserId));

  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: xUserId,
    action: "UPDATE",
    after_data: JSON.stringify({ icon_url: iconUrl, source: "upload" }),
    operator_discord_id: userId,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/");
  revalidatePath(`/user/${xUserId}`);
  return {
    ok: true,
    message: "アイコンをアップロードしました。",
    iconUrl,
  };
}
