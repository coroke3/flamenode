import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { videoChapters, videoMembers, xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "#utils/xid";
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
              WHERE ${videoChapters.id} LIKE
                CAST(member_ids.value AS TEXT) || ':legacy:%'
                OR ${videoChapters.id} LIKE
                CAST(member_ids.value AS TEXT) || ':member:%'
            )`,
          )!,
        )
        .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id))
    : [];

  const xIds = Array.from(
    new Set(
      args.members
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
              sql`${videoMembers.x_user_id} IN (
                SELECT CAST(value AS TEXT)
                FROM json_each(${JSON.stringify(xIds)})
              )`,
            )!,
          )
          .limit(MAX_VIDEO_MEMBERS * 2 + 1)
      : [];
  if (carryRows.length > MAX_VIDEO_MEMBERS * 2) {
    throw new Error("video_member_carry_limit_exceeded");
  }

  const permissionCarryByXId = new Map<
    string,
    typeof videoMembers.$inferSelect
  >();
  for (const row of [...carryRows].sort(
    (left, right) => right.can_edit - left.can_edit,
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
      ? await db.select().from(xUsers).where(inArray(xUsers.id, xIds))
      : [];
  const existingXIds = new Set(existingXUsers.map((row) => row.id.toLowerCase()));

  const newXUsers: Array<typeof xUsers.$inferInsert> = [];
  const nextMembers: Array<typeof videoMembers.$inferSelect> = [];
  for (const [index, member] of args.members.entries()) {
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
  if (!membersChanged && !chaptersChanged && newXUsers.length === 0) return plan;

  plan.statements.push(
    db.run(buildVideoMemberSetGuardSql(args.videoId, beforeSnapshot.rows)),
  );
  plan.expectedChanges.push(null);

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
