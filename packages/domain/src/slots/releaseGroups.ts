import { MAX_SLOTS_PER_VIDEO } from "./limits.ts";

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
 * 時系列順の rows について、edge 解放は残り segment が2枠以上なら既存 group id を維持する。
 * 中央解放は左 segment が2枠以上なら既存 id、右 segment が2枠以上なら newGroupId が必要。
 */
export function buildReleaseGroupDecisions(
  rows: readonly ReleaseGroupRow[],
  targetId: string,
  options?: { newGroupId?: string },
): ReleaseGroupDecision[] {
  if (
    rows.length === 0 ||
    rows.length > MAX_SLOTS_PER_VIDEO ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error("invalid_release_group_size");
  }
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (targetIndex < 0) throw new Error("release_target_not_found");

  const leftRows = rows.slice(0, targetIndex);
  const rightRows = rows.slice(targetIndex + 1);
  const isEdgeRelease =
    targetIndex === 0 || targetIndex === rows.length - 1;

  const leftGroupId =
    leftRows.length >= 2
      ? (leftRows[0]?.reservation_group_id ?? null)
      : null;

  let rightGroupId: string | null = null;
  if (rightRows.length >= 2) {
    if (isEdgeRelease) {
      rightGroupId = rightRows[0]?.reservation_group_id ?? null;
    } else if (!options?.newGroupId) {
      throw new Error("missing_new_group_id");
    } else {
      rightGroupId = options.newGroupId;
    }
  }

  return rows.map((row) => {
    if (row.id === targetId) {
      return { id: row.id, release: true, reservation_group_id: null };
    }
    if (leftRows.some((candidate) => candidate.id === row.id)) {
      return {
        id: row.id,
        release: false,
        reservation_group_id: leftGroupId,
      };
    }
    return {
      id: row.id,
      release: false,
      reservation_group_id: rightGroupId,
    };
  });
}
