export const RELATED_DEFAULT_LIMIT = 18;
export const RELATED_MIN_LIMIT = 15;
export const RELATED_MAX_LIMIT = 30;

export type RelatedReason =
  | "previous_date"
  | "next_date"
  | "temporal_neighbor"
  | "shared_member"
  | "same_event"
  | "same_creator"
  | "near_date";

export type RelatedCandidate<T> = {
  row: T;
  reason: RelatedReason;
};

type DiversityRow = {
  id: string;
  creator_x_user_id: string | null;
  primary_event_id: string | null;
};

export function clampRelatedLimit(limit = RELATED_DEFAULT_LIMIT): number {
  if (!Number.isFinite(limit)) return RELATED_DEFAULT_LIMIT;
  const value = Math.trunc(limit);
  return Math.min(RELATED_MAX_LIMIT, Math.max(RELATED_MIN_LIMIT, value));
}

export function perMemberLimit(memberCount: number): number {
  if (memberCount <= 2) return 3;
  if (memberCount <= 5) return 2;
  return 1;
}

export function uniqueByVideoId<T extends { id: string }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function interleaveBuckets<T>(
  buckets: readonly { reason: RelatedReason; rows: readonly T[] }[],
): RelatedCandidate<T>[] {
  const out: RelatedCandidate<T>[] = [];
  const max = Math.max(0, ...buckets.map((bucket) => bucket.rows.length));

  for (let i = 0; i < max; i++) {
    for (const bucket of buckets) {
      const row = bucket.rows[i];
      if (row) out.push({ row, reason: bucket.reason });
    }
  }

  return out;
}

export function enforceDiversity<T extends DiversityRow>(
  candidates: readonly RelatedCandidate<T>[],
  options: {
    limit: number;
    minTarget?: number;
    maxCreator?: number;
    maxEvent?: number;
  },
): RelatedCandidate<T>[] {
  const limit = clampRelatedLimit(options.limit);
  const minTarget = Math.min(options.minTarget ?? RELATED_MIN_LIMIT, limit);
  const maxCreator = options.maxCreator ?? 4;
  const maxEvent = options.maxEvent ?? 6;
  const sameCreatorCap = Math.max(3, Math.ceil(limit * 0.25));
  const sameEventCap = Math.max(4, Math.ceil(limit * 0.35));
  const sharedCap = limit >= RELATED_MAX_LIMIT ? 10 : 6;
  const temporalCap = Math.ceil(limit / 2);

  const seen = new Set<string>();
  const creatorCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const reasonCounts = new Map<RelatedReason, number>();
  const selected: RelatedCandidate<T>[] = [];
  const deferred: RelatedCandidate<T>[] = [];

  const canTake = (
    candidate: RelatedCandidate<T>,
    relaxed: boolean,
  ): boolean => {
    const { row, reason } = candidate;
    if (seen.has(row.id)) return false;
    if (selected.length >= limit) return false;

    if (!relaxed) {
      const last = selected[selected.length - 1]?.row;
      if (row.creator_x_user_id && last?.creator_x_user_id === row.creator_x_user_id) return false;

      if (
        reason === "same_creator" &&
        (reasonCounts.get(reason) ?? 0) >= sameCreatorCap
      ) {
        return false;
      }
      if (
        reason === "same_event" &&
        (reasonCounts.get(reason) ?? 0) >= sameEventCap
      ) {
        return false;
      }
      if (
        reason === "shared_member" &&
        (reasonCounts.get(reason) ?? 0) >= sharedCap
      ) {
        return false;
      }
      if (
        (reason === "previous_date" ||
          reason === "next_date" ||
          reason === "temporal_neighbor" ||
          reason === "near_date") &&
        (reasonCounts.get(reason) ?? 0) >= temporalCap
      ) {
        return false;
      }
    }

    if (row.creator_x_user_id && !relaxed) {
      const count = creatorCounts.get(row.creator_x_user_id) ?? 0;
      if (count >= maxCreator) return false;
    }
    if (row.primary_event_id && !relaxed) {
      const count = eventCounts.get(row.primary_event_id) ?? 0;
      if (count >= maxEvent) return false;
    }

    return true;
  };

  const take = (candidate: RelatedCandidate<T>) => {
    const { row, reason } = candidate;
    seen.add(row.id);
    if (row.creator_x_user_id) {
      creatorCounts.set(row.creator_x_user_id, (creatorCounts.get(row.creator_x_user_id) ?? 0) + 1);
    }
    if (row.primary_event_id) {
      eventCounts.set(
        row.primary_event_id,
        (eventCounts.get(row.primary_event_id) ?? 0) + 1,
      );
    }
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    selected.push(candidate);
  };

  for (const candidate of candidates) {
    if (canTake(candidate, false)) {
      take(candidate);
    } else {
      deferred.push(candidate);
    }
    if (selected.length >= limit) break;
  }

  for (const candidate of deferred) {
    if (selected.length >= minTarget) break;
    if (canTake(candidate, true)) take(candidate);
  }

  return selected.slice(0, limit);
}
