import type { DB } from "@/lib/db/client";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { QueueWakeKind, QueueWakeSource } from "@/lib/queues/wakeBudget";
import type { D1AuditMutationBudget } from "@/lib/audit/mutateBudget";
import { inspectVideoAtomicWritePlanBudget } from "@flamenode/server-core/video/videoAtomicBudget";
import type { VideoAtomicWritePlan } from "./atomicWritePlanCore";
export {
  appendVideoAtomicWritePlan,
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  mergeVideoAtomicWritePlans,
  type VideoAtomicWritePlan,
} from "./atomicWritePlanCore";

/*
 * 投稿時のアイコン・YouTubeチャンネル候補は、videosのsnapshotから候補読取側が導出する。
 * 旧候補テーブルへ投稿保存と重複する履歴行は書かず、
 * 原子的保存のDB mutation数と二重正本を増やさない。
 */

export class VideoAtomicPlanBudgetError extends Error {
  constructor(readonly budget: D1AuditMutationBudget) {
    super(`video_atomic_plan_budget_exceeded:${budget.totalQueryCount}/${budget.limit}`);
    this.name = "VideoAtomicPlanBudgetError";
  }
}

export { inspectVideoAtomicWritePlanBudget };

export async function executeVideoAtomicWritePlan(
  db: DB,
  plan: VideoAtomicWritePlan,
  options?: {
    notificationWakeSource?: QueueWakeSource;
    staticRebuildWakeSource?: QueueWakeSource;
    wakeSentKinds?: Set<QueueWakeKind>;
  },
): Promise<void> {
  if (plan.statements.length === 0 || plan.audits.length === 0) {
    throw new Error("video_atomic_plan_empty");
  }
  if (plan.statements.length !== plan.expectedChanges.length) {
    throw new Error("video_atomic_plan_expected_changes_mismatch");
  }
  const budget = inspectVideoAtomicWritePlanBudget(plan);
  if (!budget.withinLimit) throw new VideoAtomicPlanBudgetError(budget);
  await mutateWithAudit(db, {
    mutationStatements: plan.statements,
    expectedMutationChanges: plan.expectedChanges,
    audits: plan.audits,
    notificationWakeSource: options?.notificationWakeSource,
    staticRebuildWakeSource: options?.staticRebuildWakeSource,
    wakeSentKinds: options?.wakeSentKinds,
  });
}
