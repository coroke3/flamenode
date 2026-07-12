import type { BatchItem } from "drizzle-orm/batch";
import type { WriteAuditLogInput } from "../audit/types.ts";

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

export function compositeAuditTargetId(...parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}
