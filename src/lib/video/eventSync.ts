export interface VideoEventSyncTargetArgs {
  current: string[];
  requested: string[];
  alwaysInclude?: string[];
  isAdmin: boolean;
  modifiableEventIds?: Iterable<string>;
}

export interface StagePermissionAnswerDeleteScopeArgs {
  targetEventIds: string[];
  previousEventIds?: string[];
}

function unique(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function computeVideoEventSyncTarget(
  args: VideoEventSyncTargetArgs,
): string[] {
  const current = unique(args.current);
  const requested = unique(args.requested);
  const alwaysInclude = unique(args.alwaysInclude ?? []);
  if (args.isAdmin) return unique([...alwaysInclude, ...requested]);

  const modifiable = new Set(args.modifiableEventIds ?? []);
  const requestedSet = new Set(requested);
  const target = new Set<string>(alwaysInclude);

  for (const id of current) {
    if (!modifiable.has(id)) {
      target.add(id);
    } else if (requestedSet.has(id)) {
      target.add(id);
    }
  }
  for (const id of requested) {
    if (modifiable.has(id)) target.add(id);
  }

  return Array.from(target);
}

export function computeStagePermissionAnswerDeleteEventIds(
  args: StagePermissionAnswerDeleteScopeArgs,
): string[] {
  return unique([...(args.previousEventIds ?? []), ...args.targetEventIds]);
}
