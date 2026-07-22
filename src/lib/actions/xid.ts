"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getEnv } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import {
  users,
  xIdentityRequests,
  xUserAccountLinks,
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
import {
  getLinkedXUserForAuthUser,
  isAuthUserLinkedToXUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";
import {
  validateXIdentityRequestShape,
  type XIdentityRequestType,
} from "@/lib/auth/xIdentityRequestCore";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { buildPendingXIdRequestInsert } from "@/lib/actions/xidPendingInsert";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";

export interface XIdActionResult {
  ok: boolean;
  message?: string;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function isConditionalInsertAssertionError(error: unknown): boolean {
  return error instanceof Error && /malformed json/i.test(error.message);
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

async function getXIdWriteContext(): Promise<
  | { ok: true; authUserId: string; db: DB }
  | { ok: false; result: XIdActionResult }
> {
  const guard = await writeGuard({ feature: "xid_links" });
  if (!guard.ok) {
    return { ok: false, result: { ok: false, message: guard.message } };
  }
  return { ok: true, authUserId: guard.user.id, db: guard.db };
}

async function getLinkedXUser(db: DB, xUserId: string, authUserId: string) {
  return getLinkedXUserForAuthUser(db, authUserId, xUserId);
}

function requireApprovedForEdit(row: {
  approval_status: string | null;
}): XIdActionResult | null {
  if (row.approval_status !== "approved") {
    return { ok: false, message: "承認済みの X ID だけを編集できます。" };
  }
  return null;
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

function revalidateXIdentityPaths(xUserId?: string): void {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/onboarding");
  revalidatePath("/admin/x-link-requests");
  revalidatePath("/manage/x-link-requests");
  if (xUserId) revalidatePath(`/user/${xUserId}`);
}

export async function setActiveXId(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!xUserId) return { ok: false, message: "X ID が指定されていません。" };

  const db = context.db;

  const xRow = await getLinkedXUser(db, xUserId, authUserId);
  if (!xRow) {
    return { ok: false, message: "この X ID は現在のアカウントに紐づいていません。" };
  }
  if (xRow.approval_status !== "approved") {
    return { ok: false, message: "承認済みの X ID だけをアクティブにできます。" };
  }

  const beforeUser = (
    await db.select().from(users).where(eq(users.id, authUserId)).limit(1)
  )[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  if (normalizeXId(beforeUser.active_x_user_id) === xUserId) {
    return { ok: true, message: "すでにこの X ID がアクティブです。" };
  }

  const afterUser = { ...beforeUser, active_x_user_id: xUserId };
  await mutateWithAudit(db, {
    mutationStatements: [
      db
        .update(users)
        .set({ active_x_user_id: xUserId })
        .where(expectedRowCondition({ expectedCurrent: beforeUser })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "user",
        target_id: authUserId,
        operation: "UPDATE",
        before: { ...beforeUser },
        after: { ...afterUser },
        actor_user_id: authUserId,
        retention_class: "normal",
      },
    ],
  });

  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "アクティブ X ID を切り替えました。" };
}

const requestKindSchema = z.enum(["link", "merge"]);

export async function requestXIdLink(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;

  const requestedXUserId = normalizeXId(String(formData.get("x_id") ?? ""));
  if (!requestedXUserId || !/^[a-z0-9_]{1,20}$/.test(requestedXUserId)) {
    return {
      ok: false,
      message: "X ID は英数字とアンダースコア 1 から 20 文字で入力してください。",
    };
  }

  const parsedKind = requestKindSchema.safeParse(
    String(formData.get("request_type") ?? formData.get("link_type") ?? "link"),
  );
  if (!parsedKind.success) return { ok: false, message: "不正な申請種別です。" };

  const targetXUserId = normalizeXId(String(formData.get("target_x_user_id") ?? ""));
  const db = context.db;

  const existingXUser = (
    await db.select().from(xUsers).where(xUserIdMatches(requestedXUserId)).limit(1)
  )[0];
  const canonicalXUserId = await resolveCanonicalXUserId(db, requestedXUserId);

  let requestType: XIdentityRequestType;
  let sourceXUserId: string | null = null;
  let requestedXId: string | null = requestedXUserId;

  if (parsedKind.data === "merge") {
    requestType = "merge";
    sourceXUserId = requestedXUserId;
    requestedXId = null;
    if (!targetXUserId) return { ok: false, message: "統合先 X ID が必要です。" };
    if (!existingXUser) return { ok: false, message: "統合元 X ID が見つかりません。" };
    const [ownsSource, ownsTarget] = await Promise.all([
      isAuthUserLinkedToXUser(db, authUserId, sourceXUserId),
      isAuthUserLinkedToXUser(db, authUserId, targetXUserId),
    ]);
    if (!ownsSource || !ownsTarget) {
      return { ok: false, message: "自分に紐づく X ID 同士だけを統合申請できます。" };
    }
  } else {
    // import 済み・承認済みを含め、正本名義が存在するなら既存連携申請にする。
    requestType = canonicalXUserId || existingXUser ? "existing_link" : "new_link";
    if (await isAuthUserLinkedToXUser(db, authUserId, requestedXUserId)) {
      return { ok: false, message: "この X ID はすでに現在のアカウントに紐づいています。" };
    }
  }

  const shapeError = validateXIdentityRequestShape({
    requestType,
    requestedXId,
    sourceXUserId,
    targetXUserId: targetXUserId || null,
  });
  if (shapeError) return { ok: false, message: shapeError };

  const now = nowUnix();
  const id = generateId("xreq");
  const afterRequest = {
    id,
    request_type: requestType,
    requested_by_auth_user_id: authUserId,
    requested_x_id: requestedXId,
    source_x_user_id: sourceXUserId,
    target_x_user_id: targetXUserId || null,
    parent_request_id: null,
    restore_snapshot_json: null,
    revert_deadline_at: null,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };
  const xIdLabel = requestedXId ?? sourceXUserId ?? "不明";
  const webhookNotification = await buildNotificationOutboxStatement(db, {
    recipientUserId: authUserId,
    type: "discord_webhook",
    payload: {
      content: `X ID申請: @${xIdLabel} / type=${requestType} / by=${authUserId} / request=${id}`,
    },
    dedupeKey: `xid_request_webhook:${id}`,
    force: true,
  });
  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];

  if (
    (requestType === "new_link" || requestType === "existing_link") &&
    requestedXId
  ) {
    const siblingPendings = await db
      .select()
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
          eq(xIdentityRequests.requested_x_id, requestedXId),
          eq(xIdentityRequests.status, "pending"),
          inArray(xIdentityRequests.request_type, ["new_link", "existing_link"]),
        )!,
      );
    for (const sibling of siblingPendings) {
      const afterSibling = { ...sibling, status: "cancelled" as const, updated_at: now };
      mutationStatements.push(
        db
          .update(xIdentityRequests)
          .set({ status: "cancelled", updated_at: now })
          .where(expectedRowCondition({ expectedCurrent: sibling })),
      );
      expectedMutationChanges.push(1);
      audits.push({
        table_name: "x_identity_requests",
        target_id: sibling.id,
        operation: "UPDATE",
        before: { ...sibling },
        after: afterSibling,
        actor_user_id: authUserId,
        reason: "同一X IDの重複pending申請を取り消す",
        context: "x-identity-request",
        retention_class: "long_audit",
      });
    }
  }

  mutationStatements.push(db.run(buildPendingXIdRequestInsert(afterRequest)));
  expectedMutationChanges.push(1);
  audits.push({
    table_name: "x_identity_requests",
    target_id: id,
    operation: "CREATE",
    before: null,
    after: { ...afterRequest },
    actor_user_id: authUserId,
    retention_class: "long_audit",
  });
  if (webhookNotification) {
    mutationStatements.push(webhookNotification);
    expectedMutationChanges.push(null);
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
    });
  } catch (error) {
    // 条件付きINSERTの0行はmutateWithAuditのassertionでrollbackされる。
    // assertion以外の監査・DB障害は競合扱いにせず、そのまま再送出する。
    if (!isConditionalInsertAssertionError(error)) throw error;
    const duplicate = (
      await db
        .select({ id: xIdentityRequests.id })
        .from(xIdentityRequests)
        .where(
          and(
            eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
            eq(xIdentityRequests.request_type, requestType),
            eq(xIdentityRequests.status, "pending"),
            requestedXId === null
              ? sql`${xIdentityRequests.requested_x_id} IS NULL`
              : eq(xIdentityRequests.requested_x_id, requestedXId),
            sourceXUserId === null
              ? sql`${xIdentityRequests.source_x_user_id} IS NULL`
              : eq(xIdentityRequests.source_x_user_id, sourceXUserId),
            targetXUserId === null
              ? sql`${xIdentityRequests.target_x_user_id} IS NULL`
              : eq(xIdentityRequests.target_x_user_id, targetXUserId),
          )!,
        )
        .limit(1)
    )[0];
    if (duplicate) return { ok: true, message: "同じ内容の申請がすでに承認待ちです。" };

    const pendingCountRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
          eq(xIdentityRequests.status, "pending"),
        )!,
      );
    if (Number(pendingCountRows[0]?.count ?? 0) >= 5) {
      return {
        ok: false,
        message: "未処理の X ID 申請が多すぎます。処理を待ってから再申請してください。",
      };
    }
    throw error;
  }

  revalidateXIdentityPaths(requestedXUserId);
  return { ok: true, message: "X ID 申請を受け付けました。" };
}

export async function requestXIdMergeRevert(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const parentRequestId = String(formData.get("parent_request_id") ?? "").trim();
  if (!parentRequestId) return { ok: false, message: "統合申請 ID が必要です。" };

  const db = context.db;
  const parent = (
    await db.select().from(xIdentityRequests).where(eq(xIdentityRequests.id, parentRequestId)).limit(1)
  )[0];
  if (!parent || parent.request_type !== "merge" || parent.status !== "done") {
    return { ok: false, message: "差し戻し可能な統合申請が見つかりません。" };
  }
  const now = nowUnix();
  if (!parent.restore_snapshot_json || !parent.revert_deadline_at || parent.revert_deadline_at < now) {
    return { ok: false, message: "統合の差し戻し期限を過ぎています。" };
  }
  if (!parent.target_x_user_id || !(await isAuthUserLinkedToXUser(db, authUserId, parent.target_x_user_id))) {
    return { ok: false, message: "この統合を差し戻す権限がありません。" };
  }
  const existing = (
    await db
      .select({ id: xIdentityRequests.id })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.request_type, "revert_merge"),
          eq(xIdentityRequests.parent_request_id, parentRequestId),
          eq(xIdentityRequests.status, "pending"),
        )!,
      )
      .limit(1)
  )[0];
  if (existing) return { ok: true, message: "差し戻し申請はすでに承認待ちです。" };

  const id = generateId("xrevert");
  const afterRequest = {
    id,
    request_type: "revert_merge" as const,
    requested_by_auth_user_id: authUserId,
    requested_x_id: null,
    source_x_user_id: parent.source_x_user_id,
    target_x_user_id: parent.target_x_user_id,
    parent_request_id: parent.id,
    restore_snapshot_json: parent.restore_snapshot_json,
    revert_deadline_at: parent.revert_deadline_at,
    status: "pending" as const,
    requested_at: now,
    updated_at: now,
  };
  await mutateWithAudit(db, {
    mutationStatements: [db.insert(xIdentityRequests).values(afterRequest)],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_identity_requests",
        target_id: id,
        operation: "CREATE",
        before: null,
        after: { ...afterRequest },
        actor_user_id: authUserId,
        retention_class: "long_audit",
      },
    ],
  });
  revalidateXIdentityPaths(parent.target_x_user_id ?? undefined);
  revalidatePath("/admin/x-id-merges");
  return { ok: true, message: "統合の差し戻し申請を受け付けました。" };
}

export async function updateXIdProfile(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;

  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const xName = String(formData.get("x_name") ?? "").trim().slice(0, 80);
  const profileText = String(formData.get("profile_text") ?? "").trim().slice(0, 2000);
  const portfolioContact = normalizePortfolioContact(
    String(formData.get("portfolio_contact") ?? "").slice(0, 1200),
  );
  const youtubeChannelRaw = String(formData.get("youtube_channel_url") ?? "").trim();
  const otherSocialLinksRaw = String(formData.get("other_social_links") ?? "").trim();
  const youtubeChannelUrl = youtubeChannelRaw
    ? normalizeHttpUrl(youtubeChannelRaw, { maxLength: 500 })
    : null;
  const otherSocialLinks = validateSocialLinksJson(otherSocialLinksRaw);

  if (!xUserId) return { ok: false, message: "X ID が必要です。" };
  if (youtubeChannelRaw && !youtubeChannelUrl) {
    return { ok: false, message: "YouTube チャンネル URL が不正です。" };
  }
  if (!otherSocialLinks.ok) {
    return { ok: false, message: otherSocialLinks.message ?? "SNS リンクが不正です。" };
  }

  const db = context.db;
  const linked = await getLinkedXUser(db, xUserId, authUserId);
  if (!linked) return { ok: false, message: "この X ID を編集する権限がありません。" };
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;

  const updateValues = buildXUserProfileUpdate({
    displayName: xName || row.x_name?.trim() || `@${xUserId}`,
    profileText: profileText || null,
    portfolioContact,
    youtubeChannelUrl,
    otherSocialLinks: otherSocialLinks.value,
  });
  const after = { ...row, ...updateValues };
  await mutateWithAudit(db, {
    mutationStatements: [
      db.update(xUsers).set(updateValues).where(expectedRowCondition({ expectedCurrent: row })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_users",
        target_id: row.id,
        operation: "UPDATE",
        before: { ...row },
        after: { ...after },
        actor_user_id: authUserId,
        retention_class: "long_audit",
      },
    ],
  });

  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "X ID のプロフィールを更新しました。" };
}

export async function deleteLinkedXId(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!xUserId || confirm !== `DELETE ${xUserId}`) {
    return { ok: false, message: `確認のため DELETE ${xUserId} と入力してください。` };
  }

  const db = context.db;
  const link = (
    await db
      .select()
      .from(xUserAccountLinks)
      .where(
        and(
          eq(xUserAccountLinks.x_user_id, xUserId),
          eq(xUserAccountLinks.auth_user_id, authUserId),
        )!,
      )
      .limit(1)
  )[0];
  if (!link) return { ok: false, message: "この X ID の連携を削除できません。" };

  const beforeUser = (
    await db.select().from(users).where(eq(users.id, authUserId)).limit(1)
  )[0];
  if (!beforeUser) return { ok: false, message: "ユーザーが見つかりません。" };
  const mutationStatements: BatchItem<"sqlite">[] = [
    db
      .delete(xUserAccountLinks)
      .where(
        and(
          eq(xUserAccountLinks.x_user_id, xUserId),
          eq(xUserAccountLinks.auth_user_id, authUserId),
        )!,
      ),
  ];
  const expectedMutationChanges: Array<number | null> = [1];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "x_user_account_links",
      target_id: `${xUserId}:${authUserId}`,
      operation: "DELETE",
      before: { ...link },
      after: null,
      actor_user_id: authUserId,
      retention_class: "long_audit",
    },
  ];
  if (normalizeXId(beforeUser.active_x_user_id) === xUserId) {
    const afterUser = { ...beforeUser, active_x_user_id: null };
    mutationStatements.push(
      db
        .update(users)
        .set({ active_x_user_id: null })
        .where(expectedRowCondition({ expectedCurrent: beforeUser })),
    );
    expectedMutationChanges.push(1);
    audits.push({
      table_name: "user",
      target_id: authUserId,
      operation: "UPDATE",
      before: { ...beforeUser },
      after: { ...afterUser },
      actor_user_id: authUserId,
      retention_class: "long_audit",
    });
  }
  await mutateWithAudit(db, { mutationStatements, expectedMutationChanges, audits });
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "現在の認証アカウントとの X ID 連携を削除しました。" };
}

export async function setXIdIcon(formData: FormData): Promise<XIdActionResult> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const iconUrl = String(formData.get("icon_url") ?? "").trim();
  if (!xUserId || !iconUrl) return { ok: false, message: "X ID とアイコンが必要です。" };

  const db = context.db;
  if (!(await getLinkedXUser(db, xUserId, authUserId))) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;
  const candidates = await getXIconCandidates(db, xUserId, 40);
  if (!candidates.includes(iconUrl)) return { ok: false, message: "選択できないアイコンです。" };

  const after = { ...row, icon_url: iconUrl };
  await mutateWithAudit(db, {
    mutationStatements: [
      db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row })),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "x_users",
        target_id: row.id,
        operation: "UPDATE",
        before: { ...row },
        after: { ...after },
        actor_user_id: authUserId,
        reason: "icon_select",
        retention_class: "long_audit",
      },
    ],
  });
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "アイコンを更新しました。" };
}

export async function uploadXIdIcon(
  formData: FormData,
): Promise<XIdActionResult & { iconUrl?: string }> {
  const context = await getXIdWriteContext();
  if (!context.ok) return context.result;
  const { authUserId } = context;
  const xUserId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  const file = formData.get("icon_file");
  if (!xUserId || !(file instanceof File)) return { ok: false, message: "画像ファイルが必要です。" };
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: "2MB 以内の画像を選んでください。" };

  const db = context.db;
  if (!(await getLinkedXUser(db, xUserId, authUserId))) {
    return { ok: false, message: "この X ID を編集する権限がありません。" };
  }
  const row = (await db.select().from(xUsers).where(eq(xUsers.id, xUserId)).limit(1))[0];
  if (!row) return { ok: false, message: "X ID が見つかりません。" };
  const notApproved = requireApprovedForEdit(row);
  if (notApproved) return notApproved;

  const env = getEnv();
  if (!env.BUCKET) return { ok: false, message: "ストレージが利用できません。" };
  const buffer = await file.arrayBuffer();
  const image = detectSupportedImageUpload(buffer);
  if (!image) return { ok: false, message: "PNG/JPEG/WEBP 画像ファイルのみアップロードできます。" };

  const objectId = generateId("xicon");
  const stagingKey = `xicons/staging/${authUserId}/${objectId}.${image.ext}`;
  const key = `xicons/${xUserId}/${objectId}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;
  const after = { ...row, icon_url: iconUrl };
  try {
    await env.BUCKET.put(stagingKey, buffer, { httpMetadata: { contentType: image.contentType } });
    await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: image.contentType } });
    await mutateWithAudit(db, {
      mutationStatements: [
        db.update(xUsers).set({ icon_url: iconUrl }).where(expectedRowCondition({ expectedCurrent: row })),
      ],
      expectedMutationChanges: [1],
      audits: [
        {
          table_name: "x_users",
          target_id: row.id,
          operation: "UPDATE",
          before: { ...row },
          after: { ...after },
          actor_user_id: authUserId,
          reason: "icon_upload",
          retention_class: "long_audit",
        },
      ],
    });
  } catch (error) {
    await Promise.allSettled([env.BUCKET.delete(stagingKey), env.BUCKET.delete(key)]);
    throw error;
  }
  await env.BUCKET.delete(stagingKey).catch((error) => {
    console.warn("[uploadXIdIcon] staging cleanup failed", error);
  });
  revalidateXIdentityPaths(xUserId);
  return { ok: true, message: "アイコンをアップロードしました。", iconUrl };
}
