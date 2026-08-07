export type ScheduledSyncCandidate = {
  id: string;
  youtube_video_id: string;
  eligibility: number;
};

export type SyncRow = { id: string; youtube_video_id: string };

export function compareScheduledSyncCandidates(
  a: ScheduledSyncCandidate,
  b: ScheduledSyncCandidate,
): number {
  if (a.eligibility !== b.eligibility) {
    return a.eligibility - b.eligibility;
  }
  return a.id.localeCompare(b.id);
}

/** lane ごとに limit 件まで取得した候補を eligibility → id で統合する。 */
export function mergeScheduledSyncCandidates(
  lanes: readonly (readonly ScheduledSyncCandidate[])[],
  limit: number,
): SyncRow[] {
  const merged: ScheduledSyncCandidate[] = [];
  for (const lane of lanes) {
    merged.push(...lane);
  }
  merged.sort(compareScheduledSyncCandidates);
  return merged.slice(0, limit).map((row) => ({
    id: row.id,
    youtube_video_id: row.youtube_video_id,
  }));
}
