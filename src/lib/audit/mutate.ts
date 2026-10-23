// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import type { DB } from "@/lib/db/client";
import {
  mutateWithAudit as mutateWithAuditCore,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";

export * from "@flamenode/server-core/audit/mutate";

/**
 * Next supplies the Queue wake host lazily: nextPorts.ts pulls in server-only and the
 * OpenNext context, which callers that never wake a Queue must not evaluate.
 */
const loadNextQueueWakeHost = async () =>
  (await import("@/lib/serverCore/nextPorts")).nextQueueWakeHost;

export function mutateWithAudit(
  db: DB,
  input: AtomicAuditMutationInput,
): Promise<string[]> {
  return mutateWithAuditCore(db, input, loadNextQueueWakeHost);
}
