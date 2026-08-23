import { and, asc, eq, sql } from "drizzle-orm";
import { videoChapters, videoMembers, xUserAliases, xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import { isCanonicalXId, normalizeXId } from "#utils/xid";
import type { MemberInput, ParsedMemberChapter } from "@/lib/video/memberInputs";
import {
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import {
  buildVideoMemberBulkInsertSql,
  buildVideoMemberSetGuardSql,
  buildVideoMemberSetSnapshot,
  compareSqliteBinaryText,
  toVideoMemberSnapshotRow,
} from "@/lib/video/memberSetSnapshot";

/** Keep each JSON1 bind comfortably below D1/R2 string limits. */
export const VIDEO_CHAPTER_JSON_MAX_BYTES = 1_000_000;
const JSON_ENCODER = new TextEncoder();

export function jsonUtf8ByteLength(value: unknown): number {
  return JSON_ENCODER.encode(JSON.stringify(value)).byteLength;
}

/**
 * Split JSON1 rows by serialized UTF-8 bytes, not only by row count. This
 * keeps a 100 x 30 chapter replacement bounded even when notes are long or
 * multibyte. A single row larger than the cap is rejected before mutation.
 */
export function chunkRowsByJsonByteSize<T>(
  rows: readonly T[],
  maxBytes = VIDEO_CHAPTER_JSON_MAX_BYTES,
): T[][] {
  if (!Number.isInteger(maxBytes) || maxBytes < 256) {
    throw new Error("video_chapter_json_chunk_limit_invalid");
  }
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2; // []
  for (const row of rows) {
    const rowBytes = jsonUtf8ByteLength(row);
    const nextBytes = currentBytes + (current.length > 0 ? 1 : 0) + rowBytes;
    if (rowBytes + 2 > maxBytes) {
      throw new Error("video_chapter_json_row_too_large");
    }
    if (current.length > 0 && nextBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

type ChapterBulkStatement = {
  statement: ReturnType<typeof sql>;
  rowCount: number;
  payloadBytes: number;
};

function buildVideoChapterBulkDeleteSql(
  videoId: string,
  rows: readonly (typeof videoChapters.$inferSelect)[],
): ChapterBulkStatement[] {
  if (rows.length === 0) throw new Error("video_chapter_bulk_delete_empty");
  return chunkRowsByJsonByteSize(rows.map((row) => row.id)).map((chunk) => {
    const payload = JSON.stringify(chunk);
    return {
      statement: sql`
        DELETE FROM video_chapters
        WHERE video_id = ${videoId}
          AND id IN (
            SELECT CAST(value AS TEXT)
            FROM json_each(${payload})
          )
      `,
      rowCount: chunk.length,
      payloadBytes: jsonUtf8ByteLength(chunk),
    };
  });
}

function buildVideoChapterBulkInsertSql(
  rows: readonly (typeof videoChapters.$inferSelect)[],
): ChapterBulkStatement[] {
  if (rows.length === 0) throw new Error("video_chapter_bulk_insert_empty");
  return chunkRowsByJsonByteSize(rows).map((chunk) => {
    const payload = JSON.stringify(chunk);
    return {
      statement: sql`
        INSERT INTO video_chapters (
          id,
          video_id,
          x_user_id,
          chapter_time,
          chapter_label,
          note,
          visibility,
          created_at,
          updated_at
        )
        SELECT
          json_extract(value, '$.id'),
          json_extract(value, '$.video_id'),
          json_extract(value, '$.x_user_id'),
          json_extract(value, '$.chapter_time'),
          json_extract(value, '$.chapter_label'),
          json_extract(value, '$.note'),
          json_extract(value, '$.visibility'),
          json_extract(value, '$.created_at'),
          json_extract(value, '$.updated_at')
        FROM json_each(${payload})
      `,
      rowCount: chunk.length,
      payloadBytes: jsonUtf8ByteLength(chunk),
    };
  });
}

/**
 * 既存aliasを1クエリで正本X IDへ寄せる。alias変換後の重複は、同一人物を
 * 複数public member行へ分裂させるためfail-closedにする。
 */
async function canonicalizeMemberInputs(
  db: DB,
  members: readonly MemberInput[],
): Promise<MemberInput[]> {
  const normalized = members.map((member) => ({
    ...member,
    x_user_id: normalizeXId(member.x_user_id),
  }));
  const candidates = Array.from(
    new Set(normalized.map((member) => member.x_user_id).filter(Boolean)),
  );
  const aliases = candidates.length === 0
    ? []
    : await db
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
    if (!alias || !target || !isCanonicalXId(target)) {
      throw new Error("video_member_alias_target_invalid");
    }
    const targets = targetsByAlias.get(alias) ?? new Set<string>();
    targets.add(target);
    targetsByAlias.set(alias, targets);
  }
  for (const targets of targetsByAlias.values()) {
    if (targets.size > 1) throw new Error("video_member_ambiguous_x_user_alias");
  }

  const canonical = normalized.map((member) => {
    if (!member.x_user_id) return member;
    const targets = targetsByAlias.get(member.x_user_id);
    const target = targets ? Array.from(targets)[0] : undefined;
    return target ? { ...member, x_user_id: target } : member;
  });

  const seen = new Set<string>();
  for (const member of canonical) {
    const xid = member.x_user_id;
    if (!xid) continue;
    if (!isCanonicalXId(xid)) throw new Error("video_member_x_user_id_invalid");
    if (seen.has(xid)) throw new Error("video_member_duplicate_x_user_id");
    seen.add(xid);
  }
  return canonical;
}

/**
 * 公開メンバー化するX IDに既存hidden editorがある場合、その行を削除する前に
 * 読み取り時の完全snapshotと一致することを確認する。permission actionとの競合で
 * 新しいcan_editを消さないため、public member set guardとは別にfail-closedにする。
 */
function buildHiddenCarryRowsGuardSql(
  videoId: string,
  rows: readonly (typeof videoMembers.$inferSelect)[],
) {
  const expectedRows = [...rows]
    .map(toVideoMemberSnapshotRow)
    .sort((left, right) => compareSqliteBinaryText(left.id, right.id));
  const idsPayload = JSON.stringify(expectedRows.map((row) => row.id));
  const expectedJson = JSON.stringify(expectedRows);
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
            AND is_public_member = 0
            AND id IN (
              SELECT CAST(value AS TEXT) FROM json_each(${idsPayload})
            )
          ORDER BY id ASC
        )
      ) = json(${expectedJson})
      THEN 1
      ELSE json_extract('video-hidden-member-conflict', '$')
    END
  `;
}

function buildHiddenCarryRowsDeleteSql(
  videoId: string,
  rows: readonly (typeof videoMembers.$inferSelect)[],
) {
  const idsPayload = JSON.stringify(rows.map((row) => row.id));
  return sql`
    DELETE FROM video_members
    WHERE video_id = ${videoId}
      AND is_public_member = 0
      AND id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${idsPayload})
      )
  `;
}

export async function buildReplaceVideoMembersPlan(
  db: DB,
  args: {
    videoId: string;
    members: MemberInput[];
    chaptersByIndex?: Map<number, ParsedMemberChapter[]>;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  if (args.members.length > MAX_VIDEO_MEMBERS) {
    throw new Error("video_member_limit_exceeded");
  }
  const members = await canonicalizeMemberInputs(db, args.members);

  const existing = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, args.videoId),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(asc(videoMembers.order_index), asc(videoMembers.id))
    .limit(MAX_VIDEO_MEMBERS + 1);
  if (existing.length > MAX_VIDEO_MEMBERS) {
    throw new Error("video_member_existing_limit_exceeded");
  }

  const existingMemberIds = existing.map((row) => row.id);
  const existingManagedChapters = existingMemberIds.length > 0
    ? await db
        .select()
        .from(videoChapters)
        .where(
          and(
            eq(videoChapters.video_id, args.videoId),
            sql`EXISTS (
              SELECT 1
              FROM json_each(${JSON.stringify(existingMemberIds)}) AS member_ids
              WHERE instr(
                      ${videoChapters.id},
                      CAST(member_ids.value AS TEXT) || ':legacy:'
                    ) = 1
                 OR instr(
                      ${videoChapters.id},
                      CAST(member_ids.value AS TEXT) || ':member:'
                    ) = 1
            )`,
          )!,
        )
        .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id))
    : [];

  const xIds = Array.from(
    new Set(
      members
        .map((member) => normalizeXId(member.x_user_id))
        .filter(Boolean),
    ),
  );

  const carryRows =
    xIds.length > 0
      ? await db
          .select()
          .from(videoMembers)
          .where(
            and(
              eq(videoMembers.video_id, args.videoId),
              sql`lower(${videoMembers.x_user_id}) IN (
                SELECT lower(CAST(value AS TEXT))
                FROM json_each(${JSON.stringify(xIds)})
              )`,
            )!,
          )
          .limit(MAX_VIDEO_MEMBERS * 2 + 1)
      : [];
  if (carryRows.length > MAX_VIDEO_MEMBERS * 2) {
    throw new Error("video_member_carry_limit_exceeded");
  }

  const xIdSet = new Set(xIds);
  const hiddenCarryRows = carryRows.filter(
    (row) =>
      row.is_public_member === 0 &&
      Boolean(normalizeXId(row.x_user_id)) &&
      xIdSet.has(normalizeXId(row.x_user_id)),
  );

  const permissionCarryByXId = new Map<
    string,
    typeof videoMembers.$inferSelect
  >();
  for (const row of [...carryRows].sort(
    (left, right) =>
      right.can_edit - left.can_edit ||
      right.is_public_member - left.is_public_member ||
      compareSqliteBinaryText(left.id, right.id),
  )) {
    const xId = normalizeXId(row.x_user_id);
    if (xId && !permissionCarryByXId.has(xId)) {
      permissionCarryByXId.set(xId, row);
    }
  }

  const existingPublicByXId = new Map<
    string,
    typeof videoMembers.$inferSelect
  >();
  const existingPublicByName = new Map<
    string,
    typeof videoMembers.$inferSelect
  >();
  for (const row of existing) {
    const xId = normalizeXId(row.x_user_id);
    if (xId && !existingPublicByXId.has(xId)) {
      existingPublicByXId.set(xId, row);
    }
    const nameKey = row.name.trim().normalize("NFKC").toLowerCase();
    if (nameKey && !existingPublicByName.has(nameKey)) {
      existingPublicByName.set(nameKey, row);
    }
  }

  const existingXUsers =
    xIds.length > 0
      ? await db
          .select({ id: xUsers.id })
          .from(xUsers)
          .where(sql`lower(${xUsers.id}) IN (
            SELECT lower(CAST(value AS TEXT))
            FROM json_each(${JSON.stringify(xIds)})
          )`)
      : [];
  const existingXIds = new Set(existingXUsers.map((row) => normalizeXId(row.id)));

  const newXUsers: Array<typeof xUsers.$inferInsert> = [];
  const nextMembers: Array<typeof videoMembers.$inferSelect> = [];
  for (const [index, member] of members.entries()) {
    const xId = normalizeXId(member.x_user_id) || null;
    if (xId && !existingXIds.has(xId)) {
      newXUsers.push({
        id: xId,
        x_name: member.name || `@${xId}`,
        icon_url: null,
        profile_text: null,
        portfolio_contact: null,
        youtube_channel_url: null,
        other_social_links: null,
        creative_start_date: null,
        approval_status: "pending",
      });
      existingXIds.add(xId);
    }

    const previousPublic = xId
      ? existingPublicByXId.get(xId)
      : existingPublicByName.get(
          member.name.trim().normalize("NFKC").toLowerCase(),
        );
    const permissionCarry = xId
      ? permissionCarryByXId.get(xId)
      : previousPublic;

    nextMembers.push({
      id: previousPublic?.id ?? generateId("vm"),
      video_id: args.videoId,
      x_user_id: xId,
      name: member.name.trim() || (xId ? `@${xId}` : ""),
      role: member.role || null,
      comment: member.comment || null,
      order_index: index,
      can_edit: permissionCarry?.can_edit ?? 0,
      is_public_member: 1,
      edit_granted_by_auth_user_id:
        permissionCarry?.edit_granted_by_auth_user_id ?? null,
      edit_granted_at: permissionCarry?.edit_granted_at ?? null,
      edit_updated_at: permissionCarry?.edit_updated_at ?? null,
    });
  }

  const beforeSnapshot = buildVideoMemberSetSnapshot(args.videoId, existing);
  const afterSnapshot = buildVideoMemberSetSnapshot(args.videoId, nextMembers);
  const membersChanged =
    JSON.stringify(beforeSnapshot.rows) !== JSON.stringify(afterSnapshot.rows);

  const existingChapterById = new Map(
    existingManagedChapters.map((chapter) => [chapter.id, chapter]),
  );
  const now = Math.floor(Date.now() / 1000);
  const nextManagedChapters: Array<typeof videoChapters.$inferSelect> = [];
  for (const [memberIndex, member] of nextMembers.entries()) {
    const chapters = args.chaptersByIndex?.get(memberIndex) ?? [];
    for (const [chapterIndex, chapter] of chapters.entries()) {
      const id = `${member.id}:member:${chapterIndex}`;
      nextManagedChapters.push({
        id,
        video_id: args.videoId,
        x_user_id: member.x_user_id,
        chapter_time: chapter.time_seconds,
        chapter_label: chapter.label,
        note: chapter.note || null,
        visibility: "public",
        created_at: existingChapterById.get(id)?.created_at ?? now,
        updated_at: now,
      });
    }
  }
  const chapterSnapshot = (rows: Array<typeof videoChapters.$inferSelect>) =>
    rows.map((row) => ({
      id: row.id,
      video_id: row.video_id,
      x_user_id: row.x_user_id,
      chapter_time: row.chapter_time,
      chapter_label: row.chapter_label,
      note: row.note,
      visibility: row.visibility,
    }));
  const chaptersChanged =
    JSON.stringify(chapterSnapshot(existingManagedChapters)) !==
    JSON.stringify(chapterSnapshot(nextManagedChapters));

  const plan = emptyVideoAtomicWritePlan();
  if (
    !membersChanged &&
    !chaptersChanged &&
    newXUsers.length === 0 &&
    hiddenCarryRows.length === 0
  ) return plan;

  plan.statements.push(
    db.run(buildVideoMemberSetGuardSql(args.videoId, beforeSnapshot.rows)),
  );
  plan.expectedChanges.push(null);

  if (hiddenCarryRows.length > 0) {
    plan.statements.push(
      db.run(buildHiddenCarryRowsGuardSql(args.videoId, hiddenCarryRows)),
    );
    plan.expectedChanges.push(null);
  }

  if (newXUsers.length > 0) {
    const payload = JSON.stringify(newXUsers);
    plan.statements.push(
      db.run(sql`
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
      `),
    );
    plan.expectedChanges.push(newXUsers.length);
    plan.audits.push({
      table_name: "x_users_member_batch",
      target_id: args.videoId,
      operation: "CREATE",
      before: null,
      after: { id: args.videoId, rows: newXUsers },
      actor_user_id: args.actorUserId,
      context: "video-save:member-profile",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  if (hiddenCarryRows.length > 0) {
    plan.statements.push(
      db.run(buildHiddenCarryRowsDeleteSql(args.videoId, hiddenCarryRows)),
    );
    plan.expectedChanges.push(hiddenCarryRows.length);
    plan.audits.push({
      table_name: "video_member_hidden_carry_cleanup",
      target_id: args.videoId,
      operation: "DELETE",
      before: {
        id: args.videoId,
        rows: hiddenCarryRows.map(toVideoMemberSnapshotRow),
      },
      after: { id: args.videoId, rows: [] },
      actor_user_id: args.actorUserId,
      context: "video-save:members",
      reason: "公開メンバー化したX IDのhidden editorを公開行へ統合",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  }

  if (existing.length > 0) {
    plan.statements.push(
      db
        .delete(videoMembers)
        .where(
          and(
            eq(videoMembers.video_id, args.videoId),
            eq(videoMembers.is_public_member, 1),
          )!,
        ),
    );
    plan.expectedChanges.push(existing.length);
  }

  if (afterSnapshot.rows.length > 0) {
    plan.statements.push(
      db.run(buildVideoMemberBulkInsertSql(afterSnapshot.rows)),
    );
    plan.expectedChanges.push(afterSnapshot.rows.length);
  }

  if (chaptersChanged && existingManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkDeleteSql(
      args.videoId,
      existingManagedChapters,
    )) {
      plan.statements.push(db.run(chunk.statement));
      plan.expectedChanges.push(chunk.rowCount);
    }
  }
  if (chaptersChanged && nextManagedChapters.length > 0) {
    for (const chunk of buildVideoChapterBulkInsertSql(nextManagedChapters)) {
      plan.statements.push(db.run(chunk.statement));
      plan.expectedChanges.push(chunk.rowCount);
    }
  }
  if (chaptersChanged) {
    plan.audits.push({
      table_name: "video_chapters_member_set",
      target_id: args.videoId,
      operation: "MERGE",
      before: { id: args.videoId, rows: chapterSnapshot(existingManagedChapters) },
      after: { id: args.videoId, rows: chapterSnapshot(nextManagedChapters) },
      actor_user_id: args.actorUserId,
      context: "video-save:member-chapters",
      retention_class: "restorable",
      restore_strategy: "custom_adapter",
      strict: true,
    });
  }

  plan.audits.push({
    table_name: "video_members_set",
    target_id: args.videoId,
    operation: "MERGE",
    before: beforeSnapshot,
    after: afterSnapshot,
    actor_user_id: args.actorUserId,
    context: "video-save:members",
    retention_class: "restorable",
    restore_strategy: "custom_adapter",
    strict: true,
  });

  return plan;
}
