import type { StaticRelatedVideo } from "./staticVideoDetailCore";

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deterministicSeed(parts: readonly string[]): string {
  return parts.filter(Boolean).join(":");
}

function deterministicFallbackOrder(
  items: readonly StaticRelatedVideo[],
  seed: string,
): StaticRelatedVideo[] {
  return [...items].sort(
    (left, right) =>
      fnv1a(`${seed}:${left.id}`) - fnv1a(`${seed}:${right.id}`) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * primary内のrandom枠がblockedならrandom_reserveで置換し、
 * 不足時はreserve→fallback poolで埋める。blocklist障害時は呼び出し側で非表示。
 */
export function resolveVisibleRelatedVideos(args: {
  primary: readonly StaticRelatedVideo[];
  randomIds: readonly string[];
  reserve: readonly StaticRelatedVideo[];
  randomReserve: readonly StaticRelatedVideo[];
  fallbackPool?: readonly StaticRelatedVideo[];
  blockedIds: ReadonlySet<string>;
  currentVideoId: string;
  seed: string;
  minTarget?: number;
  maxTarget?: number;
}): StaticRelatedVideo[] {
  const minTarget = Math.max(0, Math.min(args.minTarget ?? 15, 30));
  const maxTarget = Math.max(minTarget, Math.min(args.maxTarget ?? 30, 30));
  const randomIds = new Set(args.randomIds);
  const seen = new Set<string>([args.currentVideoId]);
  const selected: StaticRelatedVideo[] = [];
  const randomReserve = args.randomReserve.filter(
    (item) => !args.blockedIds.has(item.id) && !seen.has(item.id),
  );
  let randomReserveIndex = 0;

  const canTake = (item: StaticRelatedVideo): boolean =>
    Boolean(item.id) &&
    !seen.has(item.id) &&
    !args.blockedIds.has(item.id) &&
    selected.length < maxTarget;

  const take = (item: StaticRelatedVideo): boolean => {
    if (!canTake(item)) return false;
    seen.add(item.id);
    selected.push(item);
    return true;
  };

  for (const item of args.primary) {
    if (take(item)) continue;
    if (!randomIds.has(item.id)) continue;

    while (randomReserveIndex < randomReserve.length) {
      const replacement = randomReserve[randomReserveIndex++];
      if (take(replacement)) break;
    }
  }

  for (const item of args.reserve) take(item);

  if (selected.length < minTarget) {
    const fallback = deterministicFallbackOrder(
      args.fallbackPool ?? [],
      args.seed,
    );
    for (const item of fallback) {
      take(item);
      if (selected.length >= minTarget) break;
    }
  }

  return selected.slice(0, maxTarget);
}
