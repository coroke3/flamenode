import type {
  StaticRelatedVideo,
} from "./staticVideoDetailCore";

export const RELATED_MIN_LIMIT = 15;
export const RELATED_DEFAULT_LIMIT = 30;
export const RELATED_MAX_LIMIT = 30;
export const RELATED_RESERVE_LIMIT = 15;
export const RELATED_RANDOM_LIMIT = 2;
export const RELATED_RANDOM_RESERVE_LIMIT =
  4;
export const RELATED_SECTION_MAX_BYTES =
  96 * 1024;

function clampInteger(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, Math.floor(value)),
  );
}

function uniqueEligible(
  source:
    readonly StaticRelatedVideo[],
  args: {
    currentVideoId: string;
    blockedIds?:
      | ReadonlySet<string>
      | null;
    used?: Set<string>;
  },
): StaticRelatedVideo[] {
  const used =
    args.used ??
    new Set<string>();
  used.add(args.currentVideoId);

  const result:
    StaticRelatedVideo[] = [];

  for (const video of source) {
    const id = video.id.trim();

    if (
      !id ||
      used.has(id) ||
      args.blockedIds?.has(id)
    ) {
      continue;
    }

    used.add(id);
    result.push(video);
  }

  return result;
}

export function stableHash32(
  value: string,
): number {
  let hash = 0x811c9dc5;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(
      hash,
      0x01000193,
    );
  }

  return hash >>> 0;
}

function createRandom(
  seed: string,
): () => number {
  let state =
    stableHash32(seed) ||
    0x9e3779b9;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return (
      (state >>> 0) /
      0x1_0000_0000
    );
  };
}

export function
selectDeterministicRandom<T>(
  source: readonly T[],
  count: number,
  seed: string,
): T[] {
  const target = clampInteger(
    count,
    0,
    source.length,
  );

  if (target === 0) return [];

  const indexes = source.map(
    (_, index) => index,
  );
  const random = createRandom(seed);

  for (
    let index = 0;
    index < target;
    index += 1
  ) {
    const replacement =
      index +
      Math.floor(
        random() *
          (indexes.length - index),
      );

    [
      indexes[index],
      indexes[replacement],
    ] = [
      indexes[replacement],
      indexes[index],
    ];
  }

  return indexes
    .slice(0, target)
    .map((index) => source[index]);
}

export function
insertRandomRelatedVideos(args: {
  semantic:
    readonly StaticRelatedVideo[];
  random:
    readonly (
      | StaticRelatedVideo
      | null
    )[];
  maxTarget?: number;
}): StaticRelatedVideo[] {
  const maxTarget = clampInteger(
    args.maxTarget ??
      RELATED_DEFAULT_LIMIT,
    1,
    RELATED_MAX_LIMIT,
  );

  const result =
    args.semantic.slice(0, maxTarget);
  const positions = [7, 21];

  args.random.forEach(
    (video, randomIndex) => {
      if (!video) return;

      const duplicate =
        result.findIndex(
          (candidate) =>
            candidate.id === video.id,
        );

      if (duplicate >= 0) {
        result.splice(duplicate, 1);
      }

      const desired =
        positions[randomIndex] ??
        result.length;

      result.splice(
        Math.min(
          desired,
          result.length,
        ),
        0,
        video,
      );
    },
  );

  return result.slice(0, maxTarget);
}

export function
resolveVisibleRelatedVideos(args: {
  primary:
    readonly StaticRelatedVideo[];
  reserve?:
    readonly StaticRelatedVideo[];
  randomIds?: readonly string[];
  randomReserve?:
    readonly StaticRelatedVideo[];
  fallbackPool?:
    readonly StaticRelatedVideo[];
  blockedIds?:
    | ReadonlySet<string>
    | null;
  currentVideoId: string;
  seed: string;
  minTarget?: number;
  maxTarget?: number;
}): StaticRelatedVideo[] {
  const maxTarget = clampInteger(
    args.maxTarget ??
      RELATED_DEFAULT_LIMIT,
    1,
    RELATED_MAX_LIMIT,
  );

  const minTarget = clampInteger(
    args.minTarget ??
      RELATED_MIN_LIMIT,
    0,
    maxTarget,
  );

  const randomIdSet = new Set(
    (args.randomIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(
        0,
        RELATED_RANDOM_LIMIT,
      ),
  );

  const primaryEligible =
    uniqueEligible(args.primary, {
      currentVideoId:
        args.currentVideoId,
      blockedIds: args.blockedIds,
    });

  const randomIds = [
    ...randomIdSet,
  ];

  const survivingRandomById =
    new Map<
      string,
      StaticRelatedVideo
    >(
      primaryEligible
        .filter((video) =>
          randomIdSet.has(video.id),
        )
        .map((video) => [
          video.id,
          video,
        ]),
    );

  const randomSlots =
    randomIds.map(
      (id) =>
        survivingRandomById.get(id) ??
        null,
    );

  const randomUsed = new Set<string>([
    args.currentVideoId,
    ...randomSlots.flatMap(
      (video) =>
        video ? [video.id] : [],
    ),
  ]);

  const randomReserve =
    uniqueEligible(
      args.randomReserve ?? [],
      {
        currentVideoId:
          args.currentVideoId,
        blockedIds: args.blockedIds,
        used: randomUsed,
      },
    );

  let randomReserveIndex = 0;

  for (
    let slotIndex = 0;
    slotIndex < randomSlots.length;
    slotIndex += 1
  ) {
    if (randomSlots[slotIndex]) {
      continue;
    }

    const replacement =
      randomReserve[
        randomReserveIndex
      ] ?? null;
    randomReserveIndex += 1;
    randomSlots[slotIndex] =
      replacement;

    if (replacement) {
      randomUsed.add(
        replacement.id,
      );
    }
  }

  const missingRandomCount =
    randomSlots.filter(
      (video) => !video,
    ).length;

  if (
    missingRandomCount > 0
  ) {
    const fallbackForRandom =
      uniqueEligible(
        args.fallbackPool ?? [],
        {
          currentVideoId:
            args.currentVideoId,
          blockedIds:
            args.blockedIds,
          used: randomUsed,
        },
      );

    const fallbackRandom =
      selectDeterministicRandom(
        fallbackForRandom,
        missingRandomCount,
        `${args.seed}:random-repair`,
      );
    let fallbackIndex = 0;

    for (
      let slotIndex = 0;
      slotIndex < randomSlots.length;
      slotIndex += 1
    ) {
      if (randomSlots[slotIndex]) {
        continue;
      }

      randomSlots[slotIndex] =
        fallbackRandom[
          fallbackIndex
        ] ?? null;
      fallbackIndex += 1;
    }
  }

  const randomVideos =
    randomSlots.flatMap(
      (video) =>
        video ? [video] : [],
    );

  const used = new Set<string>([
    args.currentVideoId,
    ...randomVideos.map(
      (video) => video.id,
    ),
  ]);

  const semanticPrimary =
    primaryEligible.filter(
      (video) =>
        !randomIdSet.has(video.id) &&
        !used.has(video.id),
    );

  for (const video of semanticPrimary) {
    used.add(video.id);
  }

  const semanticTarget =
    maxTarget -
    randomVideos.length;

  const semantic =
    semanticPrimary.slice(
      0,
      semanticTarget,
    );

  const semanticUsed =
    new Set<string>([
      args.currentVideoId,
      ...randomVideos.map(
        (video) => video.id,
      ),
      ...semantic.map(
        (video) => video.id,
      ),
    ]);

  const reserve =
    uniqueEligible(
      args.reserve ?? [],
      {
        currentVideoId:
          args.currentVideoId,
        blockedIds:
          args.blockedIds,
        used: semanticUsed,
      },
    );

  for (const video of reserve) {
    if (
      semantic.length >=
      semanticTarget
    ) {
      break;
    }

    semantic.push(video);
  }

  const currentTotal =
    semantic.length +
    randomVideos.length;

  if (currentTotal < minTarget) {
    const fallback =
      uniqueEligible(
        args.fallbackPool ?? [],
        {
          currentVideoId:
            args.currentVideoId,
          blockedIds:
            args.blockedIds,
          used: semanticUsed,
        },
      );

    semantic.push(
      ...selectDeterministicRandom(
        fallback,
        Math.min(
          semanticTarget -
            semantic.length,
          minTarget -
            currentTotal,
        ),
        `${args.seed}:semantic-repair`,
      ),
    );
  }

  return insertRandomRelatedVideos({
    semantic,
    random: randomSlots,
    maxTarget,
  });
}

export function
relatedSectionByteLength(
  value: {
    related_videos:
      readonly StaticRelatedVideo[];
    related_reserve:
      readonly StaticRelatedVideo[];
    related_random_ids:
      readonly string[];
    related_random_reserve:
      readonly StaticRelatedVideo[];
    related_random_seed: string;
  },
): number {
  return new TextEncoder().encode(
    JSON.stringify(value),
  ).byteLength;
}
