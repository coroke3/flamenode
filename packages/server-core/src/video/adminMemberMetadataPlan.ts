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
import { monotonicVideoUpdatedAt } from "@flamenode/domain/video";
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
  // The same-second CURRENT action used to write updated_at = now, which
  // could fail to advance the optimistic version. Match the visibility
  // writer's monotonic timestamp contract, also under clock skew.
  const updatedAt = monotonicVideoUpdatedAt(target.updated_at, now);
  return {
    statements: [
      db.update(videos).set({
        collaboration_type: nextCollaborationType,
        updated_at: updatedAt,
      }).where(and(
        eq(videos.id, target.id),
        eq(videos.updated_at, target.updated_at),
        eq(videos.collaboration_type, target.collaboration_type),
      )!),
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
        updated_at: updatedAt,
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
