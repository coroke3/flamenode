import { staticRebuildQueue } from "@/lib/db/schema";

/** pending/processing active 行の enqueue 更新に必要な列だけを読む。 */
export const staticRebuildActiveLookupSelect = {
  id: staticRebuildQueue.id,
  target_type: staticRebuildQueue.target_type,
  target_id: staticRebuildQueue.target_id,
  status: staticRebuildQueue.status,
  priority: staticRebuildQueue.priority,
  updated_at: staticRebuildQueue.updated_at,
  lease_token: staticRebuildQueue.lease_token,
  requested_by_user_id: staticRebuildQueue.requested_by_user_id,
} as const;

export type StaticRebuildActiveLookupRow = {
  id: string;
  target_type: string;
  target_id: string;
  status: "pending" | "processing" | "done" | "failed" | "dead_letter";
  priority: "high" | "normal" | "low";
  updated_at: number;
  lease_token: string | null;
  requested_by_user_id: string | null;
};
