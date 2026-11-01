import { videos } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * SA-086: one videos INSERT and its strict CREATE audit snapshot.
 * Pure D1 batch preparation only: no write happens before the caller's
 * mutateWithAudit/executeVideoAtomicWritePlan transaction.
 */
export function buildFreeVideoInsertPlan(
  db: ServerCoreDb,
  videoAfter: typeof videos.$inferSelect,
  actorUserId: string,
): UnslottedVideoAtomicPlan {
  return {
    statements: [db.insert(videos).values(videoAfter)],
    expectedChanges: [1],
    audits: [{
      table_name: "videos",
      target_id: videoAfter.id,
      operation: "CREATE",
      before: null,
      after: { ...videoAfter },
      actor_user_id: actorUserId,
      context: "video-save:create-free",
      retention_class: "normal",
      strict: true,
    }],
  };
}
