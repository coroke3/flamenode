import { MAX_ATOMIC_SLOT_ROWS } from "./atomicLimits.ts";

export type ReleaseGroupRow = {
  id: string;
  reservation_group_id: string | null;
};

export type ReleaseGroupDecision = {
  id: string;
  release: boolean;
  reservation_group_id: string | null;
};

/**
 * 一枠を解放した後の group 構造を決める。
 * 最大3枠なので、2枠groupの残りと3枠group中央解除後の両側は必ず単枠になる。
 */
export function buildReleaseGroupDecisions(
  rows: readonly ReleaseGroupRow[],
  targetId: string,
): ReleaseGroupDecision[] {
  if (
    rows.length === 0 ||
    rows.length > MAX_ATOMIC_SLOT_ROWS ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error("invalid_release_group_size");
  }
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (targetIndex < 0) throw new Error("release_target_not_found");

  const clearRemainingGroup =
    rows.length === 2 || (rows.length === 3 && targetIndex === 1);
  return rows.map((row) => ({
    id: row.id,
    release: row.id === targetId,
    reservation_group_id:
      row.id === targetId || clearRemainingGroup
        ? null
        : row.reservation_group_id,
  }));
}
