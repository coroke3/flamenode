/**
 * MIG-0657 U01: pure plan grouping shared by CURRENT SA-067/068 and TARGET.
 * Authorization, input status/version CAS, and D1 batch mutations stay at the caller.
 */
export type SlotRegroupMutation<Row, Patch> = {
  rows: Row[];
  patch: Patch | (Patch & { x_user_id: string | null });
  statusGuard: "reserved";
};

/** Group a shared patch into at most two D1 UPDATE statements, retaining input order. */
export function buildRegroupMutations<
  Row extends { x_user_id: string | null },
  Patch extends object,
>(
  rows: readonly Row[],
  patch: Patch,
  identity: { targetXId: string | null; adoptNullRows: boolean },
): SlotRegroupMutation<Row, Patch>[] {
  const keepRows: Row[] = [];
  const adoptRows: Row[] = [];
  for (const row of rows) {
    if (
      identity.adoptNullRows &&
      row.x_user_id === null &&
      identity.targetXId !== null
    ) {
      adoptRows.push(row);
    } else {
      keepRows.push(row);
    }
  }
  return [
    ...(keepRows.length
      ? [{ rows: keepRows, patch, statusGuard: "reserved" as const }]
      : []),
    ...(adoptRows.length
      ? [{
          rows: adoptRows,
          patch: { ...patch, x_user_id: identity.targetXId },
          statusGuard: "reserved" as const,
        }]
      : []),
  ];
}
