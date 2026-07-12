import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { mutateWithAudit } from "@/lib/audit/mutate";

export interface VideoAtomicWritePlan {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
}

export function emptyVideoAtomicWritePlan(): VideoAtomicWritePlan {
  return { statements: [], expectedChanges: [], audits: [] };
}

export function mergeVideoAtomicWritePlans(
  ...plans: readonly VideoAtomicWritePlan[]
): VideoAtomicWritePlan {
  return {
    statements: plans.flatMap((plan) => plan.statements),
    expectedChanges: plans.flatMap((plan) => plan.expectedChanges),
    audits: plans.flatMap((plan) => plan.audits),
  };
}

export function appendVideoAtomicWritePlan(
  target: VideoAtomicWritePlan,
  plan: VideoAtomicWritePlan,
): void {
  target.statements.push(...plan.statements);
  target.expectedChanges.push(...plan.expectedChanges);
  target.audits.push(...plan.audits);
}

export async function executeVideoAtomicWritePlan(
  db: DB,
  plan: VideoAtomicWritePlan,
): Promise<void> {
  if (plan.statements.length === 0 || plan.audits.length === 0) {
    throw new Error("video_atomic_plan_empty");
  }
  if (plan.statements.length !== plan.expectedChanges.length) {
    throw new Error("video_atomic_plan_expected_changes_mismatch");
  }
  await mutateWithAudit(db, {
    mutationStatements: plan.statements,
    expectedMutationChanges: plan.expectedChanges,
    audits: plan.audits,
  });
}

export function compositeAuditTargetId(...parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}
