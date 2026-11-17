/**
 * MIG-0650 U03p: SA-085 strict video collaboration metadata mutation + audit
 * planner shared by the current Next action and future UNMOUNTED Hono host.
 *
 * Do not execute these statements individually: the caller must append this
 * plan inside the SAME member-set CAS, member/chapter mutations, strict audit
 * and rebuild queue D1 batch. No authorization, D1 execution or Queue wake here.
 */
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videos } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import type { WriteAuditLogInput } from "../audit/types.ts";

type VideoMetadata = Pick<
  typeof videos.$inferSelect,
  "id" | "collaboration_type" | "updated_at"
>;

export function buildAdminVideoMemberMetadataPlan(
  db: ServerCoreDb,
  input: {
    target: VideoMetadata;
    nextCollaborationType: "collab" | "individual";
    now: number;
    actorUserId: string;
    publicContentChanged: boolean;
  },
): {
  statements: BatchItem<"sqlite">[];
  expectedChanges: Array<number | null>;
  audits: WriteAuditLogInput[];
} {
  if (!input.publicContentChanged) {
    return { statements: [], expectedChanges: [], audits: [] };
  }
  const { target, nextCollaborationType, now, actorUserId } = input;
  // MIG-0650 U03av: the authorized video snapshot can become stale between
  // its pre-read and the atomic member/chapter/strict-audit/Queue batch.
  // A metadata-only save has no member replacement CAS to stop a concurrent
  // collaboration edit. Require both the pre-read collaboration type and
  // updated_at in the UPDATE WHERE, with exactly one affected row. This
  // prevents stale strict before/after audits and lost collaboration updates.
  // The caller must execute this statement inside the same atomic D1 batch.
  return {
    statements: [
      db.update(videos).set({
        collaboration_type: nextCollaborationType,
        updated_at: now,
      }).where(and(
        eq(videos.id, target.id),
        eq(videos.collaboration_type, target.collaboration_type),
        eq(videos.updated_at, target.updated_at),
      )),
    ],
    expectedChanges: [1],
    audits: [{
      table_name: "videos",
      target_id: target.id,
      operation: "UPDATE",
      before: {
        id: target.id,
        collaboration_type: target.collaboration_type,
        updated_at: target.updated_at,
      },
      after: {
        id: target.id,
        collaboration_type: nextCollaborationType,
        updated_at: now,
      },
      actor_user_id: actorUserId,
      context: "admin-video-members",
      reason: "参加者設定から合作区分を同期",
      retention_class: "normal",
      restore_strategy: "none",
      strict: true,
    }],
  };
}
