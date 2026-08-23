"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  type CanEditVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import {
  users,
  videoMembers,
  videos,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import {
  MAX_COLLABORATOR_PERMISSION_BATCH,
  MAX_VIDEO_MEMBERS,
} from "@/lib/video/atomicLimits";
import { generateId } from "@/lib/utils/id";
import { isCanonicalXId, normalizeXId } from "@/lib/utils/xid";
import { buildKnownRecipientNotificationBulkBatch } from "@/lib/notifications/enqueue";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { memberSuggestionsTarget } from "@/lib/staticRebuild/hooks";
import {
  getLinkedXUserIdsForAuthUser,
  resolveCanonicalXUserId,
} from "@/lib/auth/xIdentity";

export interface VideoCollabResult {
  ok: boolean;
  message?: string;
}

export interface VideoCollabPermissionBatchResult extends VideoCollabResult {
  granted?: string[];
  revoked?: string[];
  unchanged?: number;
}

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type VideoMemberRow = typeof videoMembers.$inferSelect;
type PermissionIntent = {
  x_user_id: string;
  display_name: string;
  intent: "on" | "off";
};

type EditableVideo = Pick<
  typeof videos.$inferSelect,
  | "id"
  | "title"
  | "primary_event_id"
  | "creator_x_user_id"
  | "submitted_by_user_id"
  | "visibility_status"
> & { privilegeMode: CanEditVideoPrivilegeMode };

async function revalidateVideoCollabPathsBestEffort(videoId: string): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "video_collab_permissions", traceId: createTraceId() },
    [
      {
        name: "revalidate_video_collab_paths",
        run: async () => {
          revalidatePath(`/dashboard/edit/${videoId}`);
          revalidatePath(`/dashboard/edit/${videoId}/permissions`);
        },
      },
    ],
  );
}

const optionalXIdSchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => normalizeXId(value ?? ""))
  .refine((value) => !value || isCanonicalXId(value), {
    message: "X ID は英数字とアンダースコア20文字以内で入力してください。",
  });

const permissionXIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((value) => normalizeXId(value))
  .refine((value) => isCanonicalXId(value), {
    message: "X ID は英数字とアンダースコア20文字以内で入力してください。",
  });

const upsertSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  x_user_id: optionalXIdSchema,
  user_id: z.string().trim().max(128).optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  can_edit: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "1" || value === "true" || value === undefined),
  notify: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((value) => value === "1"),
});

const permissionIntentSchema = z.object({
  x_user_id: permissionXIdSchema,
  display_name: z.string().trim().min(1).max(80),
  intent: z.union([z.literal("on"), z.literal("off")]),
});

const permissionBatchSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  edit_privilege_mode: z.enum(["normal", "admin", "event"]).optional(),
  notify: z.boolean().optional().default(true),
  intents: z
    .array(permissionIntentSchema)
    .min(1)
    .max(MAX_COLLABORATOR_PERMISSION_BATCH),
});

async function resolvePrivilegeMode(
  db: DB,
  rawMode: string,
  user: { id: string; role?: string | null },
  video: Pick<
    typeof videos.$inferSelect,
    | "id"
    | "primary_event_id"
    | "creator_x_user_id"
    | "submitted_by_user_id"
    | "visibility_status"
  >,
): Promise<CanEditVideoPrivilegeMode> {
  if (rawMode === "admin" && user.role === "admin") return "admin";
  if (rawMode === "event") {
    const canUseEvent = await canUseEventPrivilegeModeForVideo({ db, user, video });
    if (canUseEvent) return "event";
  }
  return "normal";
}

/**
 * video.permissions の認可を single / batch で共有する。
 * mode 未指定時だけ normal → admin → event を安全に補完する。
 */
async function loadEditableVideoForPermissions(
  db: DB,
  actor: { id: string; role?: string | null },
  videoId: string,
  privilegeModeRaw: string,
): Promise<EditableVideo | null> {
  const row = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        primary_event_id: videos.primary_event_id,
        creator_x_user_id: videos.creator_x_user_id,
        submitted_by_user_id: videos.submitted_by_user_id,
        visibility_status: videos.visibility_status,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!row) return null;

  const video = {
    ...row,
    submitted_by_user_id: row.submitted_by_user_id ?? "",
  };
  const requested = privilegeModeRaw.trim();
  const requestedMode = await resolvePrivilegeMode(db, requested, actor, video);
  const requestedAllowed = await canEditVideo({
    db,
    user: actor,
    video,
    requiredKey: "video.permissions",
    privilegeMode: requestedMode,
  });
  if (requestedAllowed) return { ...video, privilegeMode: requestedMode };

  if (requested) return null;
  if (actor.role === "admin") {
    const adminAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "admin",
    });
    if (adminAllowed) return { ...video, privilegeMode: "admin" };
  }

  const canUseEvent = await canUseEventPrivilegeModeForVideo({ db, user: actor, video });
  if (canUseEvent) {
    const eventAllowed = await canEditVideo({
      db,
      user: actor,
      video,
      requiredKey: "video.permissions",
      privilegeMode: "event",
    });
    if (eventAllowed) return { ...video, privilegeMode: "event" };
  }
  return null;
}

async function resolveSubjectXUserId(
  db: DB,
  xUserId: string | null,
  authUserId: string | null,
): Promise<{ ok: true; xUserId: string } | { ok: false; message: string }> {
  if (xUserId) {
    const canonical = (await resolveCanonicalXUserId(db, xUserId)) ?? xUserId;
    if (authUserId) {
      const approvedLinks = await getLinkedXUserIdsForAuthUser(db, authUserId, {
        approvedOnly: true,
      });
      if (!approvedLinks.includes(canonical)) {
        return {
          ok: false,
          message: "指定した認証ユーザーはその承認済み X ID に紐づいていません。",
        };
      }
    }
    return { ok: true, xUserId: canonical };
  }

  if (!authUserId) return { ok: false, message: "共同編集者の X ID が必要です。" };
  const linked = await getLinkedXUserIdsForAuthUser(db, authUserId, {
    approvedOnly: true,
  });
  if (linked.length === 0) {
    return { ok: false, message: "指定した認証ユーザーに承認済み X ID がありません。" };
  }
  if (linked.length > 1) {
    return {
      ok: false,
      message: "複数の X ID が紐づいているため、共同編集者の X ID を明示してください。",
    };
  }
  return { ok: true, xUserId: linked[0]! };
}

/**
 * 最大100件のpermission intentを、x_user_aliases 1クエリで現行X IDへ解決する。
 * aliasと現行IDが同一正本へ収束した場合は、後段の重複検査で拒否する。
 */
async function canonicalizePermissionIntents(
  db: DB,
  input: readonly PermissionIntent[],
): Promise<PermissionIntent[]> {
  const normalized = input.map((item) => ({
    ...item,
    x_user_id: normalizeXId(item.x_user_id),
  }));
  const candidates = Array.from(
    new Set(normalized.map((item) => item.x_user_id).filter(Boolean)),
  );
  if (candidates.length === 0) return normalized;

  const aliases = await db
    .select({
      alias_x_id: xUserAliases.alias_x_id,
      x_user_id: xUserAliases.x_user_id,
    })
    .from(xUserAliases)
    .where(sql`lower(${xUserAliases.alias_x_id}) IN (
      SELECT lower(CAST(value AS TEXT))
      FROM json_each(${JSON.stringify(candidates)})
    )`);

  const targetsByAlias = new Map<string, Set<string>>();
  for (const row of aliases) {
    const alias = normalizeXId(row.alias_x_id);
    const target = normalizeXId(row.x_user_id);
    if (!alias || !target) continue;
    const targets = targetsByAlias.get(alias) ?? new Set<string>();
    targets.add(target);
    targetsByAlias.set(alias, targets);
  }
  for (const [alias, targets] of targetsByAlias) {
    if (targets.size > 1) {
      throw new Error(`ambiguous_x_user_alias:${alias}`);
    }
  }

  return normalized.map((item) => {
    const target = targetsByAlias.get(item.x_user_id);
    const canonical = target ? Array.from(target)[0] : undefined;
    return canonical ? { ...item, x_user_id: canonical } : item;
  });
}

function permissionSnapshotRow(row: VideoMemberRow) {
  return {
    id: row.id,
    video_id: row.video_id,
    x_user_id: row.x_user_id,
    name: row.name,
    role: row.role,
    comment: row.comment,
    order_index: row.order_index,
    can_edit: row.can_edit,
    is_public_member: row.is_public_member,
    edit_granted_by_auth_user_id: row.edit_granted_by_auth_user_id,
    edit_granted_at: row.edit_granted_at,
    edit_updated_at: row.edit_updated_at,
  };
}

function sortPermissionRows(rows: readonly VideoMemberRow[]): VideoMemberRow[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function buildPermissionSetGuardSql(
  videoId: string,
  xids: readonly string[],
  expectedRows: readonly VideoMemberRow[],
) {
  const xidsPayload = JSON.stringify([...xids].sort());
  const expectedPayload = JSON.stringify(
    sortPermissionRows(expectedRows).map(permissionSnapshotRow),
  );
  return sql`
    SELECT CASE
      WHEN (
        SELECT COALESCE(json_group_array(json(row_json)), json('[]'))
        FROM (
          SELECT json_object(
            'id', id,
            'video_id', video_id,
            'x_user_id', x_user_id,
            'name', name,
            'role', role,
            'comment', comment,
            'order_index', order_index,
            'can_edit', can_edit,
            'is_public_member', is_public_member,
            'edit_granted_by_auth_user_id', edit_granted_by_auth_user_id,
            'edit_granted_at', edit_granted_at,
            'edit_updated_at', edit_updated_at
          ) AS row_json
          FROM video_members
          WHERE video_id = ${videoId}
            AND x_user_id IS NOT NULL
            AND lower(x_user_id) IN (
              SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
            )
          ORDER BY id ASC
        )
      ) = json(${expectedPayload})
      THEN 1
      ELSE json_extract('video-permission-set-conflict', '$')
    END
  `;
}

function buildMemberCountGuardSql(videoId: string, expectedCount: number) {
  return sql`
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM video_members WHERE video_id = ${videoId}) = ${expectedCount}
      THEN 1
      ELSE json_extract('video-member-count-conflict', '$')
    END
  `;
}

function buildXUsersBulkInsertSql(rows: readonly (typeof xUsers.$inferInsert)[]) {
  const payload = JSON.stringify(rows);
  return sql`
    INSERT INTO x_users (
      id,
      x_name,
      icon_url,
      profile_text,
      portfolio_contact,
      youtube_channel_url,
      other_social_links,
      creative_start_date,
      approval_status
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.x_name'),
      json_extract(value, '$.icon_url'),
      json_extract(value, '$.profile_text'),
      json_extract(value, '$.portfolio_contact'),
      json_extract(value, '$.youtube_channel_url'),
      json_extract(value, '$.other_social_links'),
      json_extract(value, '$.creative_start_date'),
      json_extract(value, '$.approval_status')
    FROM json_each(${payload})
  `;
}

/**
 * 権限batchは表示用の name/role/comment を変更しない。
 * members_json と permission intent を分離する契約をDB mutationでも守る。
 */
function buildMemberPermissionBulkUpdateSql(rows: readonly VideoMemberRow[]) {
  const payload = JSON.stringify(rows.map(permissionSnapshotRow));
  return sql`
    WITH patches AS (
      SELECT
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.can_edit') AS can_edit,
        json_extract(value, '$.edit_granted_by_auth_user_id') AS edit_granted_by_auth_user_id,
        json_extract(value, '$.edit_granted_at') AS edit_granted_at,
        json_extract(value, '$.edit_updated_at') AS edit_updated_at
      FROM json_each(${payload})
    )
    UPDATE video_members
    SET
      can_edit = (SELECT can_edit FROM patches WHERE patches.id = video_members.id),
      edit_granted_by_auth_user_id = (
        SELECT edit_granted_by_auth_user_id FROM patches WHERE patches.id = video_members.id
      ),
      edit_granted_at = (
        SELECT edit_granted_at FROM patches WHERE patches.id = video_members.id
      ),
      edit_updated_at = (
        SELECT edit_updated_at FROM patches WHERE patches.id = video_members.id
      )
    WHERE id IN (SELECT id FROM patches)
  `;
}

function buildHiddenMemberBulkInsertSql(rows: readonly VideoMemberRow[]) {
  const payload = JSON.stringify(rows.map(permissionSnapshotRow));
  return sql`
    INSERT INTO video_members (
      id,
      video_id,
      x_user_id,
      name,
      role,
      comment,
      order_index,
      can_edit,
      is_public_member,
      edit_granted_by_auth_user_id,
      edit_granted_at,
      edit_updated_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.video_id'),
      json_extract(value, '$.x_user_id'),
      json_extract(value, '$.name'),
      json_extract(value, '$.role'),
      json_extract(value, '$.comment'),
      json_extract(value, '$.order_index'),
      json_extract(value, '$.can_edit'),
      json_extract(value, '$.is_public_member'),
      json_extract(value, '$.edit_granted_by_auth_user_id'),
      json_extract(value, '$.edit_granted_at'),
      json_extract(value, '$.edit_updated_at')
    FROM json_each(${payload})
  `;
}

function buildHiddenMemberBulkDeleteSql(videoId: string, ids: readonly string[]) {
  const payload = JSON.stringify(ids);
  return sql`
    DELETE FROM video_members
    WHERE video_id = ${videoId}
      AND is_public_member = 0
      AND id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${payload})
      )
  `;
}

async function loadNotifiableRecipientLinks(
  db: DB,
  xids: readonly string[],
): Promise<Array<{ x_user_id: string; auth_user_id: string }>> {
  if (xids.length === 0) return [];
  const payload = JSON.stringify(Array.from(new Set(xids)));
  return db
    .select({
      x_user_id: xUserAccountLinks.x_user_id,
      auth_user_id: xUserAccountLinks.auth_user_id,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .innerJoin(users, eq(users.id, xUserAccountLinks.auth_user_id))
    .where(
      and(
        sql`lower(${xUserAccountLinks.x_user_id}) IN (
          SELECT lower(CAST(value AS TEXT)) FROM json_each(${payload})
        )`,
        eq(xUsers.approval_status, "approved"),
        eq(users.is_notification_enabled, 1),
      )!,
    );
}

/**
 * 手動付与/解除とTSV一括反映の共通実装。
 * 1 X ID = 1 permission intent として扱い、同一batch内の重複は曖昧なので拒否する。
 */
async function applyPermissionIntentsToVideo(
  db: DB,
  actor: { id: string; role?: string | null },
  video: EditableVideo,
  args: {
    intents: readonly PermissionIntent[];
    notify: boolean;
  },
): Promise<VideoCollabPermissionBatchResult> {
  const canonicalIntents = await canonicalizePermissionIntents(db, args.intents);
  const intents = new Map<string, { displayName: string; intent: "on" | "off" }>();
  const duplicateXids = new Set<string>();
  for (const item of canonicalIntents) {
    const xid = normalizeXId(item.x_user_id);
    if (!xid || !isCanonicalXId(xid)) {
      return { ok: false, message: "有効な X ID を指定してください。" };
    }
    if (intents.has(xid)) {
      duplicateXids.add(xid);
      continue;
    }
    intents.set(xid, {
      displayName: item.display_name.trim() || `@${xid}`,
      intent: item.intent,
    });
  }
  if (duplicateXids.size > 0) {
    return {
      ok: false,
      message: `同じ X ID の権限指定が重複しています: ${Array.from(duplicateXids)
        .map((xid) => `@${xid}`)
        .join("、")}`,
    };
  }

  const xids = Array.from(intents.keys());
  if (xids.length === 0) {
    return {
      ok: true,
      message: "変更対象がありません。",
      granted: [],
      revoked: [],
      unchanged: 0,
    };
  }

  const xidsPayload = JSON.stringify(xids);
  const existingRowLimit = MAX_VIDEO_MEMBERS + xids.length + 1;
  const existingRows = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        isNotNull(videoMembers.x_user_id),
        sql`lower(${videoMembers.x_user_id}) IN (
          SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
        )`,
      )!,
    )
    .limit(existingRowLimit);
  if (existingRows.length >= existingRowLimit) {
    return {
      ok: false,
      message: "同じ X ID の権限行が多すぎるため、安全に更新できません。重複データを整理してください。",
    };
  }

  const rowsByXid = new Map<string, VideoMemberRow[]>();
  for (const row of existingRows) {
    const key = normalizeXId(row.x_user_id ?? "");
    if (!key) continue;
    const current = rowsByXid.get(key) ?? [];
    current.push(row);
    rowsByXid.set(key, current);
  }
  for (const rows of rowsByXid.values()) {
    rows.sort(
      (left, right) =>
        right.is_public_member - left.is_public_member ||
        right.can_edit - left.can_edit ||
        left.id.localeCompare(right.id),
    );
  }

  const currentCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id));
  const currentMemberCount = Number(currentCountRow[0]?.count ?? 0);
  let nextMemberCount = currentMemberCount;

  const grantXids = xids.filter((xid) => intents.get(xid)?.intent === "on");
  const existingProfiles =
    grantXids.length === 0
      ? []
      : await db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(sql`lower(${xUsers.id}) IN (
            SELECT lower(CAST(value AS TEXT))
            FROM json_each(${JSON.stringify(grantXids)})
          )`)
          .limit(grantXids.length + 1);
  const existingProfileIds = new Set(
    existingProfiles.map((row) => normalizeXId(row.id)),
  );

  const now = Math.floor(Date.now() / 1000);
  const updateRows: VideoMemberRow[] = [];
  const insertHiddenRows: VideoMemberRow[] = [];
  const deleteHiddenIds: string[] = [];
  const newXUsers: Array<typeof xUsers.$inferInsert> = [];
  const grantedNames: string[] = [];
  const revokedNames: string[] = [];
  const notifyXids: string[] = [];
  let unchanged = 0;

  for (const [xid, intentInfo] of intents) {
    const label = `${intentInfo.displayName} @${xid}`;
    const rowsForXid = rowsByXid.get(xid) ?? [];
    const publicRows = rowsForXid.filter((row) => row.is_public_member === 1);
    const hiddenRows = rowsForXid.filter((row) => row.is_public_member === 0);
    const hadEffectiveEdit = rowsForXid.some((row) => row.can_edit === 1);

    if (intentInfo.intent === "on") {
      if (!existingProfileIds.has(xid)) {
        newXUsers.push({
          id: xid,
          x_name: intentInfo.displayName || `@${xid}`,
          icon_url: null,
          profile_text: null,
          portfolio_contact: null,
          youtube_channel_url: null,
          other_social_links: null,
          creative_start_date: null,
          approval_status: "pending",
        });
        existingProfileIds.add(xid);
      }

      if (publicRows.length > 0) {
        const permissionSource = [...rowsForXid].sort(
          (left, right) =>
            right.can_edit - left.can_edit ||
            Number(right.edit_updated_at ?? 0) - Number(left.edit_updated_at ?? 0) ||
            left.id.localeCompare(right.id),
        )[0]!;

        // 同一X IDの公開行が複数あっても、表示データを残したまま権限だけ揃える。
        for (const target of publicRows) {
          if (target.can_edit === 1) continue;
          updateRows.push({
            ...target,
            can_edit: 1,
            edit_granted_by_auth_user_id:
              permissionSource.can_edit === 1
                ? permissionSource.edit_granted_by_auth_user_id
                : actor.id,
            edit_granted_at:
              permissionSource.can_edit === 1 && permissionSource.edit_granted_at != null
                ? permissionSource.edit_granted_at
                : now,
            edit_updated_at: now,
          });
        }
        for (const hidden of hiddenRows) {
          deleteHiddenIds.push(hidden.id);
          nextMemberCount -= 1;
        }
      } else if (hiddenRows.length > 0) {
        const target = hiddenRows[0]!;
        if (target.can_edit !== 1) {
          updateRows.push({
            ...target,
            can_edit: 1,
            edit_granted_by_auth_user_id: actor.id,
            edit_granted_at: target.edit_granted_at ?? now,
            edit_updated_at: now,
          });
        }
        for (const duplicate of hiddenRows.slice(1)) {
          deleteHiddenIds.push(duplicate.id);
          nextMemberCount -= 1;
        }
      } else {
        insertHiddenRows.push({
          id: generateId("vm"),
          video_id: video.id,
          x_user_id: xid,
          name: intentInfo.displayName || `@${xid}`,
          role: null,
          comment: null,
          order_index: 9999,
          can_edit: 1,
          is_public_member: 0,
          edit_granted_by_auth_user_id: actor.id,
          edit_granted_at: now,
          edit_updated_at: now,
        });
        nextMemberCount += 1;
      }

      if (hadEffectiveEdit) {
        unchanged += 1;
      } else {
        grantedNames.push(label);
        if (args.notify) notifyXids.push(xid);
      }
      continue;
    }

    for (const row of publicRows) {
      if (row.can_edit !== 1) continue;
      updateRows.push({ ...row, can_edit: 0, edit_updated_at: now });
    }
    for (const hidden of hiddenRows) {
      deleteHiddenIds.push(hidden.id);
      nextMemberCount -= 1;
    }
    if (hadEffectiveEdit) revokedNames.push(label);
    else unchanged += 1;
  }

  if (insertHiddenRows.length > 0 && nextMemberCount > MAX_VIDEO_MEMBERS) {
    return {
      ok: false,
      message: `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。これ以上編集権を付与できません。`,
    };
  }

  if (
    updateRows.length === 0 &&
    insertHiddenRows.length === 0 &&
    deleteHiddenIds.length === 0 &&
    newXUsers.length === 0
  ) {
    return {
      ok: true,
      message: `編集権限を反映しました（付与 0 / 解除 0 / 変更なし ${unchanged}）`,
      granted: [],
      revoked: [],
      unchanged,
    };
  }

  const statements: BatchItem<"sqlite">[] = [];
  const expected: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];

  statements.push(db.run(buildPermissionSetGuardSql(video.id, xids, existingRows)));
  expected.push(null);
  if (insertHiddenRows.length > 0 || deleteHiddenIds.length > 0) {
    statements.push(db.run(buildMemberCountGuardSql(video.id, currentMemberCount)));
    expected.push(null);
  }
  if (newXUsers.length > 0) {
    statements.push(db.run(buildXUsersBulkInsertSql(newXUsers)));
    expected.push(newXUsers.length);
    audits.push({
      table_name: "x_users_permission_batch",
      target_id: video.id,
      operation: "CREATE",
      before: null,
      after: { id: video.id, rows: newXUsers },
      actor_user_id: actor.id,
      context: "video_collab_permissions",
      reason: `共同編集者X IDをpending一括作成 privilege:${video.privilegeMode}`,
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }
  if (updateRows.length > 0) {
    statements.push(db.run(buildMemberPermissionBulkUpdateSql(updateRows)));
    expected.push(updateRows.length);
  }
  if (insertHiddenRows.length > 0) {
    statements.push(db.run(buildHiddenMemberBulkInsertSql(insertHiddenRows)));
    expected.push(insertHiddenRows.length);
  }
  if (deleteHiddenIds.length > 0) {
    statements.push(db.run(buildHiddenMemberBulkDeleteSql(video.id, deleteHiddenIds)));
    expected.push(deleteHiddenIds.length);
  }

  const afterById = new Map(existingRows.map((row) => [row.id, row]));
  for (const row of updateRows) afterById.set(row.id, row);
  for (const id of deleteHiddenIds) afterById.delete(id);
  for (const row of insertHiddenRows) afterById.set(row.id, row);
  audits.push({
    table_name: "video_member_permissions_batch",
    target_id: video.id,
    operation: "MERGE",
    before: {
      id: video.id,
      rows: sortPermissionRows(existingRows).map(permissionSnapshotRow),
    },
    after: {
      id: video.id,
      rows: sortPermissionRows([...afterById.values()]).map(permissionSnapshotRow),
    },
    actor_user_id: actor.id,
    context: "video_collab_permissions",
    reason: `共同編集権限を一括更新 privilege:${video.privilegeMode}`,
    retention_class: "long_audit",
    restore_strategy: "none",
    strict: true,
  });

  let notificationWakeSource: "manage" | undefined;
  if (notifyXids.length > 0) {
    const links = await loadNotifiableRecipientLinks(db, notifyXids);
    const notificationByKey = new Map<
      string,
      {
        recipientUserId: string;
        type: "video_edit_permission_granted";
        dedupeKey: string;
        payload: ReturnType<typeof buildVideoEditPermissionGrantedNotification>;
        eventId: string | null;
      }
    >();
    for (const link of links) {
      if (link.auth_user_id === actor.id) continue;
      const dedupeKey = `video_edit_permission_granted:${video.id}:x:${link.x_user_id}:user:${link.auth_user_id}`;
      notificationByKey.set(dedupeKey, {
        recipientUserId: link.auth_user_id,
        type: "video_edit_permission_granted",
        dedupeKey,
        payload: buildVideoEditPermissionGrantedNotification({
          videoId: video.id,
          videoTitle: video.title,
        }),
        eventId: video.primary_event_id,
      });
    }

    const notificationInputs = [...notificationByKey.values()];
    for (let offset = 0; offset < notificationInputs.length; offset += 200) {
      const notification = await buildKnownRecipientNotificationBulkBatch(
        db,
        notificationInputs.slice(offset, offset + 200),
      );
      statements.push(...notification.statements);
      expected.push(...notification.expectedChanges);
      if (notification.statements.length > 0) notificationWakeSource = "manage";
    }
  }

  const queue = await buildStaticRebuildQueueBatch(db, [
    memberSuggestionsTarget("video_permissions_batch"),
  ]);
  statements.push(...queue.statements);
  expected.push(...queue.expectedChanges);

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      notificationWakeSource,
      staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] permission mutation failed", error);
    return {
      ok: false,
      message: "編集権限・通知・監査の更新に失敗しました。最新状態を確認して再試行してください。",
    };
  }

  await revalidateVideoCollabPathsBestEffort(video.id);
  return {
    ok: true,
    message: `編集権限を反映しました（付与 ${grantedNames.length} / 解除 ${revokedNames.length} / 変更なし ${unchanged}）`,
    granted: grantedNames,
    revoked: revokedNames,
    unchanged,
  };
}

function getDatabaseForPermissionAction(): DB | null {
  try {
    return getDatabase();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] database binding unavailable", error);
    return null;
  }
}

export async function upsertVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const parsed = upsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  const db = getDatabaseForPermissionAction();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      parsed.data.video_id,
      String(formData.get("edit_privilege_mode") ?? "").trim(),
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }

    const resolved = await resolveSubjectXUserId(
      db,
      parsed.data.x_user_id || null,
      parsed.data.user_id?.trim() || null,
    );
    if (!resolved.ok) return { ok: false, message: resolved.message };

    const result = await applyPermissionIntentsToVideo(db, actor, video, {
      notify: parsed.data.notify,
      intents: [
        {
          x_user_id: resolved.xUserId,
          display_name: parsed.data.display_name,
          intent: parsed.data.can_edit ? "on" : "off",
        },
      ],
    });
    if (!result.ok) return result;
    return {
      ok: true,
      message: parsed.data.can_edit
        ? "作品編集への参加を付与しました。"
        : "作品編集への参加を無効化しました。",
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator action failed", error);
    return { ok: false, message: "合作権限の読込・更新に失敗しました。" };
  }
}

export async function deleteVideoCollaborator(
  formData: FormData,
): Promise<VideoCollabResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const rawXId = normalizeXId(String(formData.get("x_user_id") ?? ""));
  if (!videoId || !rawXId || !isCanonicalXId(rawXId)) {
    return { ok: false, message: "video_id と有効な X ID が必要です。" };
  }

  const db = getDatabaseForPermissionAction();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      videoId,
      String(formData.get("edit_privilege_mode") ?? "").trim(),
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }
    const resolved = await resolveSubjectXUserId(db, rawXId, null);
    if (!resolved.ok) return { ok: false, message: resolved.message };

    const result = await applyPermissionIntentsToVideo(db, actor, video, {
      notify: false,
      intents: [
        {
          x_user_id: resolved.xUserId,
          display_name: `@${resolved.xUserId}`,
          intent: "off",
        },
      ],
    });
    if (!result.ok) return result;
    return { ok: true, message: "作品編集への参加を解除しました。" };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] collaborator revoke failed", error);
    return { ok: false, message: "合作権限の読込・解除に失敗しました。" };
  }
}

/** TSV権限列の最大100件一括反映。 */
export async function applyVideoCollaboratorPermissionsBatch(
  input: unknown,
): Promise<VideoCollabPermissionBatchResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const actor = { id: guard.user.id, role: guard.user.role ?? null };

  const parsed = permissionBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }

  const db = getDatabaseForPermissionAction();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  try {
    const video = await loadEditableVideoForPermissions(
      db,
      actor,
      parsed.data.video_id,
      parsed.data.edit_privilege_mode ?? "",
    );
    if (!video) {
      return { ok: false, message: "対象作品が見つからない、または権限がありません。" };
    }

    return await applyPermissionIntentsToVideo(db, actor, video, {
      notify: parsed.data.notify,
      intents: parsed.data.intents,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[video-collab-perms] batch preparation failed", error);
    return { ok: false, message: "合作権限の読込・準備に失敗しました。" };
  }
}
