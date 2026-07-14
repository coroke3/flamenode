"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import {
  users,
  videos,
  xAccountLinkRequests,
  xUserIcons,
  xUsers,
} from "@/lib/db/schema";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { detectSupportedImageUpload } from "@/lib/utils/imageUpload";
import { generateId } from "@/lib/utils/id";
import { normalizeHttpUrl } from "@/lib/utils/url";
import { normalizePortfolioContact } from "@/lib/profileContact";
import { normalizeXId } from "@/lib/utils/xid";
import { validateSocialLinksJson } from "@/lib/socialLinks";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import type { BatchItem } from "drizzle-orm/batch";

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

async function assertLinkedXUser(db: NonNullable<ReturnType<typeof getDatabase>>, xUserId: string, userId: string) {
  const row = (
    await db.select().from(xUsers).where(xUserIdMatches(xUserId)).limit(1)
  )[0];
  if (!row || row.linked_user_id !== userId) return null;
  return row;
}

function buildXUserProfileUpdate(values: {
  displayName: string;
  profileText: string | null;
  portfolioContact: string | null;
  youtubeChannelUrl: string | null;
  otherSocialLinks: string | null;
}): Pick<
  typeof xUsers.$inferInsert,
  "x_name" | "profile_text" | "portfolio_contact" | "youtube_channel_url" | "other_social_links"
> {
  return {
    x_name: values.displayName,
    profile_text: values.profileText,
    portfolio_contact: values.portfolioContact,
    youtube_channel_url: values.youtubeChannelUrl,
    other_social_links: values.otherSocialLinks,
  };
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

  const beforeUser = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  const afterUser = { ...beforeUser, active_x_user_id: xUserId };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(users).set({ active_x_user_id: xUserId }).where(
      expectedRowCondition({ expectedCurrent: beforeUser }),
    )],
    expectedMutationChanges: [1],
    audits: [{ table_name: "user", target_id: userId, operation: "UPDATE", before: { ...beforeUser }, after: { ...afterUser }, actor_user_id: userId, retention_class: "normal" }],
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
  if (existingUser?.linked_user_id === userId) {
    return {
      ok: false,
      message: "この X ID はすでに現在のアカウントに紐づいています。",
    };
  }
  if (
    existingUser?.linked_user_id &&
    existingUser.linked_user_id !== userId &&
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
          eq(xAccountLinkRequests.user_id, userId),
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
        eq(xAccountLinkRequests.user_id, userId),
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
  const afterRequest = {
    id,
    user_id: userId,
    requested_x_id: requestedXId,
    link_type: linkType,
    target_x_user_id: targetXUserId || null,
    status: "pending" as const,
    requested_at: now,
  };
  await mutateWithAudit(db, {
    mutationStatements: [db.insert(xAccountLinkRequests).values(afterRequest)],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_account_link_requests", target_id: id, operation: "CREATE", before: null, after: { ...afterRequest }, actor_user_id: userId, retention_class: "long_audit" }],
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/onboarding");
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
  const xName = String(formData.get("x_name") ?? "").trim().slice(0, 80);
  const profileText = String(formData.get("profile_text") ?? "")
    .trim()
    .slice(0, 2000);
  const portfolioContact = normalizePortfolioContact(
    String(formData.get("portfolio_contact") ?? "").slice(0, 1200),
  );
  const youtubeChannelRaw = String(
    formData.get("youtube_channel_url") ?? "",
  ).trim();
  const otherSocialLinksRaw = String(
    formData.get("other_social_links") ?? "",
  ).trim();
  const youtubeChannelUrl = youtubeChannelRaw
    ? normalizeHttpUrl(youtubeChannelRaw, { maxLength: 500 })
    : null;
  const otherSocialLinks = validateSocialLinksJson(otherSocialLinksRaw);

  if (!xUserId) {
    return { ok: false, message: "X ID が必要です。" };
  }
  if (youtubeChannelRaw && !youtubeChannelUrl) {
    return {
      ok: false,
      message: "YouTube チャンネル URL は http/https の有効な URL を入力してください。",
    };
  }
  if (!otherSocialLinks.ok) {
    return {
      ok: false,
      message:
        otherSocialLinks.message ??
        "SNS リンクには http/https または mailto の有効な URL を入力してください。",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const row = await assertLinkedXUser(db, xUserId, userId);
  if (!row) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }
  const displayName = xName || String(row.x_name ?? "").trim() || xUserId;

  const profileValues = {
    displayName,
    profileText: profileText || null,
    portfolioContact,
    youtubeChannelUrl,
    otherSocialLinks: otherSocialLinks.value,
  };
  const updateValues = buildXUserProfileUpdate(profileValues);
  const after = { ...row, ...updateValues };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(xUsers).set(updateValues).where(
      expectedRowCondition({ expectedCurrent: row }),
    )],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_users", target_id: row.id, operation: "UPDATE", before: { ...row }, after: { ...after }, actor_user_id: userId, retention_class: "long_audit" }],
  });

  revalidatePath("/dashboard/settings");
  revalidatePath(`/user/${xUserId}`);
  return { ok: true, message: "X ID のプロフィールを更新しました。" };
}export async function deleteLinkedXId(
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

  const beforeUser = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  const afterXUser = { ...row, linked_user_id: null, approval_status: "pending" as const };
  const mutationStatements: BatchItem<"sqlite">[] = [db.update(xUsers).set({ linked_user_id: null, approval_status: "pending" }).where(expectedRowCondition({ expectedCurrent: row }))];
  const expectedMutationChanges = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "x_users", target_id: row.id, operation: "UPDATE", before: { ...row }, after: { ...afterXUser }, actor_user_id: userId, retention_class: "long_audit" }];
  if (normalizeXId(beforeUser.active_x_user_id) === xUserId) {
    const afterUser = { ...beforeUser, active_x_user_id: null };
    mutationStatements.push(db.update(users).set({ active_x_user_id: null }).where(expectedRowCondition({ expectedCurrent: beforeUser })));
    expectedMutationChanges.push(1);
    audits.push({ table_name: "user", target_id: userId, operation: "UPDATE", before: { ...beforeUser }, after: { ...afterUser }, actor_user_id: userId, retention_class: "long_audit" });
  }
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges,
    audits,
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

  const after = { ...row, icon_url: iconUrl };
  await mutateWithAudit(db, {
    mutationStatements: [db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row }))],
    expectedMutationChanges: [1],
    audits: [{ table_name: "x_users", target_id: row.id, operation: "UPDATE", before: { ...row }, after: { ...after }, actor_user_id: userId, reason: "icon_select", retention_class: "long_audit" }],
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

  const objectId = generateId("xicon");
  const stagingKey = `xicons/staging/${userId}/${objectId}.${image.ext}`;
  const key = `xicons/${xUserId}/${objectId}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;

  const now = nowUnix();
  const afterIcon = {
    id: objectId,
    x_user_id: xUserId,
    icon_url: iconUrl,
    source_video_id: null,
    source_type: "manual" as const,
    created_at: now,
  };
  const afterXUser = { ...row, icon_url: iconUrl };
  try {
    await env.BUCKET.put(stagingKey, buffer, {
      httpMetadata: { contentType: image.contentType },
    });
    await env.BUCKET.put(key, buffer, {
      httpMetadata: { contentType: image.contentType },
    });
    await mutateWithAudit(db, {
      mutationStatements: [
        db.insert(xUserIcons).values(afterIcon),
        db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row })),
      ],
      expectedMutationChanges: [1, 1],
      audits: [
        { table_name: "x_user_icons", target_id: objectId, operation: "CREATE", before: null, after: { ...afterIcon }, actor_user_id: userId, retention_class: "long_audit" },
        { table_name: "x_users", target_id: row.id, operation: "UPDATE", before: { ...row }, after: { ...afterXUser }, actor_user_id: userId, reason: "icon_upload", retention_class: "long_audit" },
      ],
    });
  } catch (error) {
    await Promise.allSettled([env.BUCKET.delete(stagingKey), env.BUCKET.delete(key)]);
    throw error;
  }
  await env.BUCKET.delete(stagingKey).catch((error) => {
    console.warn("[uploadXIdIcon] staging cleanup failed", error);
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
