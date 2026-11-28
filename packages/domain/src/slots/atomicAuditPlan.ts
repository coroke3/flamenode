/**
 * MIG-0657 U01g — pure preflight and audit snapshot planning for SA-065..068.
 * This is not a D1 mutation executor: the host retains row/version/snapshot
 * CAS, operation/actor authorization, atomic audit+Queue, and postcommit.
 * Keep its first-failure message and audit delta identical to CURRENT.
 */
export type SlotAtomicMutationStatus = "available" | "reserved" | "submitted";

export function buildSlotAtomicAuditPlan<
  Row extends { id: string; version: number; updated_at: number },
  Patch extends object,
>(
  mutations: readonly {
    rows: readonly Row[];
    patch: Patch;
    statusGuard?: SlotAtomicMutationStatus;
  }[],
  now: number,
): {
  updates: Array<{
    rows: readonly Row[];
    patch: Patch;
    statusGuard?: SlotAtomicMutationStatus;
    expectedChanges: number;
  }>;
  auditDeltas: Array<{
    targetId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
} {
  const auditedIds = new Set<string>();
  const updates: Array<{
    rows: readonly Row[];
    patch: Patch;
    statusGuard?: SlotAtomicMutationStatus;
    expectedChanges: number;
  }> = [];
  const auditDeltas: Array<{
    targetId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];
  for (const mutation of mutations) {
    if (mutation.rows.length === 0) continue;
    for (const row of mutation.rows) {
      if (auditedIds.has(row.id)) {
        throw new Error("同一枠を複数の更新に含めることはできません。");
      }
      auditedIds.add(row.id);
    }
    updates.push({
      rows: mutation.rows,
      patch: mutation.patch,
      statusGuard: mutation.statusGuard,
      expectedChanges: mutation.rows.length,
    });
    for (const row of mutation.rows) {
      auditDeltas.push({
        targetId: row.id,
        before: { ...row },
        after: {
          ...row,
          ...mutation.patch,
          updated_at: now,
          version: row.version + 1,
        },
      });
    }
  }
  if (updates.length === 0) {
    throw new Error("更新対象の枠がありません。");
  }
  return { updates, auditDeltas };
}
