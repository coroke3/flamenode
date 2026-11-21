import { sql } from "drizzle-orm";
import { videoChapters } from "@flamenode/db/schema";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import type { ValidatedMemberSubmission } from "@flamenode/domain/video";
import { isCanonicalXId, normalizeXId } from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import { resolveCanonicalXUserResolutions } from "../xid/requestIdentity.ts";
import {
  buildVideoMemberBulkInsertSql,
  buildVideoMemberSetSnapshot,
  type VideoMemberSnapshotRow,
} from "./memberSetSnapshot.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";
import { buildFreeVideoMemberIdentityGuardSql } from "./freeVideoMemberIdentityGuard.ts";

const MAX_CHAPTER_ROW_JSON_BYTES = 1_000_000;
const MAX_CHAPTER_JSON_BINDS = 90;
const MAX_MEMBER_CHAPTERS = 30;
const encoder = new TextEncoder();

function chunkChapterRows(rows: readonly (typeof videoChapters.$inferSelect)[]) {
  const chunks: (typeof videoChapters.$inferSelect)[][] = [];
  let current: (typeof videoChapters.$inferSelect)[] = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
    if (rowBytes + 2 > MAX_CHAPTER_ROW_JSON_BYTES) {
      throw new Error("free_video_member_chapter_json_row_too_large");
    }
    if (current.length && bytes + rowBytes + 1 > MAX_CHAPTER_ROW_JSON_BYTES) {
      chunks.push(current);
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += rowBytes + (current.length === 1 ? 0 : 1);
  }
  if (current.length) chunks.push(current);
  if (chunks.length > MAX_CHAPTER_JSON_BINDS) {
    throw new Error("free_video_member_chapter_json_bind_limit_exceeded");
  }
  return chunks;
}

/**
 * MIG-0651 SA-086 U02 UNMOUNTED, **new-video only** (no legacy member rows).
 * CURRENT's canonical X resolution, pending X placeholder, public member-set
 * audit and member chapter summary. All writes are PREPARED, never executed.
 * The caller must include the statements in the same audited D1 batch AFTER
 * the new video row, and count the resolver's actual 2 reads per 80 X IDs.
 *
 * It is not an update/edit member algorithm. A same-batch SQL assertion now
 * rejects alias/approval remaps between pre-read and commit; full Worker CPU
 * and Hono use still require live-runtime validation before mounting.
 */
export async function buildFreeVideoNewMemberPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    actorUserId: string;
    now: number;
    submission: ValidatedMemberSubmission;
  },
): Promise<UnslottedVideoAtomicPlan> {
  const { videoId, actorUserId, now, submission } = args;
  if (!videoId?.trim() || !actorUserId?.trim() ||
      !Number.isSafeInteger(now) || now < 0 ||
      !submission || !Array.isArray(submission.members) ||
      !(submission.chaptersByIndex instanceof Map) ||
      submission.members.length > MAX_VIDEO_MEMBERS) {
    throw new Error("free_video_new_member_arguments_invalid");
  }
  const members = submission.members;
  if (!members.length) {
    if (submission.chaptersByIndex.size !== 0) {
      throw new Error("free_video_new_member_chapter_index_invalid");
    }
    return { statements: [], expectedChanges: [], audits: [] };
  }
  const candidates = new Set<string>();
  for (const [index, member] of members.entries()) {
    const xid = normalizeXId(member.x_user_id);
    if (!member.name?.trim() && !xid) {
      throw new Error("free_video_new_member_empty");
    }
    if (member.x_user_id && !isCanonicalXId(xid)) {
      throw new Error("free_video_new_member_xid_invalid");
    }
    if (!Number.isInteger(index) || typeof member.role !== "string" ||
        typeof member.comment !== "string" || typeof member.name !== "string" ||
        member.name.length > 80 || member.role.length > 80 ||
        member.comment.length > 500) {
      throw new Error("free_video_new_member_fields_invalid");
    }
    if (xid) candidates.add(xid);
    const chapters = submission.chaptersByIndex.get(index) ?? [];
    if (!Array.isArray(chapters) || chapters.length > MAX_MEMBER_CHAPTERS) {
      throw new Error("free_video_new_member_chapter_count_invalid");
    }
    for (const chapter of chapters) {
      if (!Number.isFinite(chapter.time_seconds) ||
          !Number.isSafeInteger(chapter.time_seconds) || chapter.time_seconds < 0 ||
          !chapter.label?.trim() || chapter.label.length > 120 ||
          typeof chapter.note !== "string" || chapter.note.length > 1000) {
        throw new Error("free_video_new_member_chapter_invalid");
      }
    }
  }
  for (const key of submission.chaptersByIndex.keys()) {
    if (!Number.isSafeInteger(key) || key < 0 || key >= members.length) {
      throw new Error("free_video_new_member_chapter_index_invalid");
    }
  }

  // CURRENT lifecycle resolver covers direct, alias, ambiguous and rejected.
  const canonical = await resolveCanonicalXUserResolutions(db, [...candidates]);
  const seenCanonical = new Set<string>();
  const newXUsers: Array<{
    id: string; x_name: string; icon_url: null; profile_text: null;
    portfolio_contact: null; youtube_channel_url: null;
    other_social_links: null; creative_start_date: null;
    approval_status: "pending";
  }> = [];
  const rows: VideoMemberSnapshotRow[] = [];
  const identities: Array<{ candidate: string; canonical: string; allowAbsent: boolean }> = [];
  for (const [index, member] of members.entries()) {
    const original = normalizeXId(member.x_user_id);
    const resolved = original ? canonical.get(original) : undefined;
    if (original && (!resolved || !["not_found", "resolved_alias", "resolved_canonical"].includes(resolved.reason))) {
      throw new Error("free_video_new_member_identity_unresolvable");
    }
    const xId = original
      ? (resolved?.reason === "not_found" ? original : resolved?.value ?? null)
      : null;
    if (xId && !isCanonicalXId(xId)) {
      throw new Error("free_video_new_member_canonical_id_invalid");
    }
    if (xId && seenCanonical.has(xId)) {
      throw new Error("free_video_new_member_duplicate_canonical_id");
    }
    if (xId) seenCanonical.add(xId);
    if (original && xId) identities.push({
      candidate: original,
      canonical: xId,
      allowAbsent: resolved?.reason === "not_found",
    });
    if (xId && resolved?.reason === "not_found") {
      newXUsers.push({
        id: xId, x_name: member.name.trim() || `@${xId}`,
        icon_url: null, profile_text: null, portfolio_contact: null,
        youtube_channel_url: null, other_social_links: null,
        creative_start_date: null, approval_status: "pending",
      });
    }
    rows.push({
      id: generateId("vm"), video_id: videoId, x_user_id: xId,
      name: member.name.trim() || (xId ? `@${xId}` : ""),
      role: member.role.trim() || null, comment: member.comment.trim() || null,
      order_index: index, can_edit: 0, is_public_member: 1,
      edit_granted_by_auth_user_id: null, edit_granted_at: null,
      edit_updated_at: null,
    });
  }

  const chapters: (typeof videoChapters.$inferSelect)[] = [];
  for (const [index, member] of rows.entries()) {
    const parts = submission.chaptersByIndex.get(index) ?? [];
    for (const [chapterIndex, chapter] of parts.entries()) {
      chapters.push({
        id: `${member.id}:member:${chapterIndex}`,
        video_id: videoId, x_user_id: member.x_user_id,
        chapter_time: chapter.time_seconds, chapter_label: chapter.label,
        note: chapter.note.trim() || null,
        visibility: "public", created_at: now, updated_at: now,
      });
    }
  }

  const statements: UnslottedVideoAtomicPlan["statements"] = [];
  const expectedChanges: UnslottedVideoAtomicPlan["expectedChanges"] = [];
  const audits: UnslottedVideoAtomicPlan["audits"] = [];
  if (identities.length) {
    // Must precede profile/member mutations: fail the whole D1 batch if alias
    // or approval state changed since the two canonical resolver reads.
    statements.push(db.run(buildFreeVideoMemberIdentityGuardSql(identities)));
    expectedChanges.push(null);
  }
  if (newXUsers.length) {
    const payload = JSON.stringify(newXUsers);
    statements.push(db.run(sql`
      INSERT INTO x_users (
        id,x_name,icon_url,profile_text,portfolio_contact,youtube_channel_url,
        other_social_links,creative_start_date,approval_status
      )
      SELECT json_extract(value,'$.id'),json_extract(value,'$.x_name'),
        json_extract(value,'$.icon_url'),json_extract(value,'$.profile_text'),
        json_extract(value,'$.portfolio_contact'),json_extract(value,'$.youtube_channel_url'),
        json_extract(value,'$.other_social_links'),json_extract(value,'$.creative_start_date'),
        json_extract(value,'$.approval_status')
      FROM json_each(${payload})
      WHERE 1=1
      ON CONFLICT(id) DO UPDATE SET id=excluded.id
    `));
    expectedChanges.push(newXUsers.length);
    audits.push({
      table_name: "x_users_member_batch", target_id: videoId,
      operation: "MERGE", before: null, after: { id: videoId, rows: newXUsers },
      actor_user_id: actorUserId, context: "video-save:member-profile",
      reason: "参加者X IDプロフィール行をpendingで一括確保",
      retention_class: "long_audit", restore_strategy: "none", strict: true,
    });
  }

  // One 2-bind JSON1 bulk insert, never 100 one-member statements.
  statements.push(db.run(buildVideoMemberBulkInsertSql(rows)));
  expectedChanges.push(rows.length);
  const after = buildVideoMemberSetSnapshot(videoId, rows);
  audits.push({
    table_name: "video_members_set", target_id: videoId,
    operation: "MERGE",
    before: buildVideoMemberSetSnapshot(videoId, []), after,
    actor_user_id: actorUserId, context: "video-save:members",
    retention_class: "restorable", restore_strategy: "custom_adapter", strict: true,
  });

  if (chapters.length) {
    const chunks = chunkChapterRows(chapters);
    const sources = chunks.map(chunk => sql`SELECT value FROM json_each(${JSON.stringify(chunk)})`);
    const sourceSql = sql.join(sources, sql` UNION ALL `);
    statements.push(db.run(sql`
      INSERT INTO video_chapters (
        id,video_id,x_user_id,chapter_time,chapter_label,note,visibility,created_at,updated_at
      )
      SELECT json_extract(value,'$.id'),json_extract(value,'$.video_id'),
        json_extract(value,'$.x_user_id'),json_extract(value,'$.chapter_time'),
        json_extract(value,'$.chapter_label'),json_extract(value,'$.note'),
        json_extract(value,'$.visibility'),json_extract(value,'$.created_at'),
        json_extract(value,'$.updated_at')
      FROM (${sourceSql})
    `));
    expectedChanges.push(chapters.length);
    const seconds = chapters.map(row => row.chapter_time);
    audits.push({
      table_name: "video_chapters_member_set", target_id: videoId,
      operation: "MERGE",
      before: { id: videoId, row_count: 0, member_count: 0,
        min_time: null, max_time: null, note_count: 0 },
      after: {
        id: videoId, row_count: chapters.length,
        member_count: new Set(chapters.map(row => row.x_user_id).filter(Boolean)).size,
        min_time: Math.min(...seconds), max_time: Math.max(...seconds),
        note_count: chapters.filter(row => row.note).length,
      },
      actor_user_id: actorUserId, context: "video-save:member-chapters",
      reason: "管理チャプター集合を更新（CPU/D1負荷抑制のため監査は集約情報のみ保持）",
      retention_class: "long_audit", restore_strategy: "none", strict: true,
    });
  }

  return { statements, expectedChanges, audits };
}
