import {
  TOP_ANNOUNCEMENTS_OBJECT_KEY,
  TOP_EVENTS_OBJECT_KEY,
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_SECTION_OBJECT_KEYS,
  TOP_STATS_OBJECT_KEY,
} from "../../src/lib/publicData/staticTopSectionsCore.ts";
import { enqueueTopSectionRebuild } from "./topRebuildEnqueue.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const TOP_SECTION_TARGET_BY_OBJECT_KEY = {
  [TOP_RECOMMENDED_OBJECT_KEY]: "top_recommended",
  [TOP_LATEST_OBJECT_KEY]: "top_latest",
  [TOP_NOSTALGIC_OBJECT_KEY]: "top_nostalgic",
  [TOP_EVENTS_OBJECT_KEY]: "top_events",
  [TOP_ANNOUNCEMENTS_OBJECT_KEY]: "top_announcements",
  [TOP_STATS_OBJECT_KEY]: "top_stats",
} as const satisfies Record<
  (typeof TOP_SECTION_OBJECT_KEYS)[number],
  string
>;

/** R2上の top section artifact が欠けていれば該当 global target を enqueue する。 */
export async function ensureTopSectionsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();

  const heads = await Promise.all(
    TOP_SECTION_OBJECT_KEYS.map((objectKey) => env.R2.head(objectKey)),
  );

  let totalChanges = 0;
  for (let index = 0; index < TOP_SECTION_OBJECT_KEYS.length; index += 1) {
    options.signal?.throwIfAborted();
    if (heads[index]) {
      continue;
    }

    const objectKey = TOP_SECTION_OBJECT_KEYS[index];
    const targetType = TOP_SECTION_TARGET_BY_OBJECT_KEY[objectKey];
    totalChanges += await enqueueTopSectionRebuild(
      env,
      targetType,
      options.reason,
      options.priority,
      options.signal,
    );
  }

  return totalChanges;
}
